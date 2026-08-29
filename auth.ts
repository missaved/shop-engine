// Auth.js v5 配置：Credentials（手机号+密码）+ JWT session
// session 里注入 shopId / role，供 DAL 做租户隔离与授权
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { CredentialsSignin } from 'next-auth'
import type { DefaultSession } from 'next-auth'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import {
  ADMIN_LIMIT_OPTS,
  clearFailures,
  clientIp,
  isRateLimited,
  recordFailure,
} from '@/lib/rate-limit'
import { decryptSecret, verifyTOTP } from '@/lib/totp'
import type { UserRole } from '@/generated/prisma/enums'

// 登录限流专用错误：继承 CredentialsSignin，用 code 区分（客户端 signIn 返回 res.code）
class RateLimitedSignin extends CredentialsSignin {
  code = 'RATE_LIMITED'
}

// 第 20 批 A3：TOTP 两步登录错误。NEED_TOTP=密码对但缺验证码（前端转第二步）；TOTP_INVALID=验证码错（计限流）
class NeedTotpSignin extends CredentialsSignin {
  code = 'NEED_TOTP'
}

class TotpInvalidSignin extends CredentialsSignin {
  code = 'TOTP_INVALID'
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 }, // 会话 7 天过期（显式生命周期，替换默认 30 天）
  trustHost: true, // 局域网 IP 访问时信任 host，否则报 UntrustedHost
  // 局域网 http 兼容：AUTH_URL=https 会让 cookie 全部带 __Secure-/__Host- 前缀 + Secure 属性，
  // 浏览器在 http 局域网 IP（192.168.5.210:3000）下不发送 Secure cookie → 登录必 MissingCSRF。
  // 显式关掉后 cookie 变普通 host-only（authjs.* 无前缀、非 Secure），http/https 都能登录；
  // 生产 https 仍安全（cloudflare 只暴露 https，http 会 301 到 https，2026-08-29 修复）。
  useSecureCookies: false,
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        phone: { label: 'Phone', type: 'tel' },
        password: { label: 'Password', type: 'password' },
        otp: { label: 'TOTP', type: 'text' },
      },
      authorize: async (credentials, request) => {
        const phone =
          typeof credentials?.phone === 'string' ? credentials.phone : ''
        const password =
          typeof credentials?.password === 'string' ? credentials.password : ''
        // 前端 pwd 步骤不传 otp，URLSearchParams 会把 null 序列化成字符串 "null"；
        // 只有 6 位数字才视为验证码，否则一律当空（第 20 批 A3）
        const rawOtp = typeof credentials?.otp === 'string' ? credentials.otp : ''
        const otp = /^\d{6}$/.test(rawOtp) ? rawOtp : ''
        if (!phone || !password) return null

        // 登录限流：IP + 手机号双维度。先查用户定档——owner 5 次/60s（原有行为不变）；
        // admin 3 次/5 分钟 + 1 小时累计 6 次失败封禁 1 小时（第 20 批 A1，独立更严档）。
        const ip = clientIp(request)
        // 第 20 批后：ADMIN 用用户名（username）登录（后台不用手机号当管理员名）；
        // owner 无 username，仍按手机号匹配。OR 查询两者兼容。
        const user = await prisma.user.findFirst({
          where: { OR: [{ phone }, { username: phone }] },
        })
        const isAdmin = user?.role === 'ADMIN'
        const limitOpts = isAdmin ? ADMIN_LIMIT_OPTS : undefined
        const ipKey = isAdmin ? `admin:ip:${ip}` : `ip:${ip}`
        const phoneKey = isAdmin ? `admin:phone:${phone}` : `phone:${phone}`

        if (isRateLimited(ipKey, limitOpts) || isRateLimited(phoneKey, limitOpts)) {
          throw new RateLimitedSignin()
        }

        if (!user) {
          recordFailure(ipKey, limitOpts)
          recordFailure(phoneKey, limitOpts)
          return null
        }

        const ok = await compare(password, user.passwordHash)
        if (!ok) {
          recordFailure(ipKey, limitOpts)
          recordFailure(phoneKey, limitOpts)
          return null
        }

        // 第 20 批 A3 + 审计修复：clearFailures 延迟到「完全登录成功」才执行。
        // 原「密码通过即清」会让连续错 otp 时每次先被清空，验证码爆破防护形同虚设（补测抓到）。
        // 现语义：密码错 / otp 错都累计；NEED_TOTP（密码对但缺 otp，正常第一步）不记；全对登录成功才清。
        // 调试期（2026-08-29 用户报 2FA 死锁进不去）：TOTP_BYPASS=true 时跳过 TOTP 强制，登录只需密码；
        // 设置页可关闭/重绑（admin-actions 同步放宽）。生产去掉该环境变量即恢复强制 2FA。
        if (user.totpEnabled && process.env.TOTP_BYPASS !== 'true') {
          if (!otp) throw new NeedTotpSignin()
          let secret: string
          try {
            secret = decryptSecret(user.totpSecret ?? '')
          } catch {
            // 解密失败（数据损坏/密钥变化）不累计算失败，避免异常导致账号锁死
            throw new TotpInvalidSignin()
          }
          if (!verifyTOTP(secret, otp)) {
            recordFailure(ipKey, limitOpts)
            recordFailure(phoneKey, limitOpts)
            throw new TotpInvalidSignin()
          }
        }

        // 完全登录成功：清空该 ip/phone 的失败计数（owner 无 TOTP，密码对即到此）
        clearFailures(ipKey)
        clearFailures(phoneKey)

        return {
          id: user.id,
          name: user.name ?? user.phone,
          phone: user.phone,
          shopId: user.shopId,
          role: user.role,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.shopId = user.shopId
        token.role = user.role
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.sub ?? '') as string
        session.user.shopId = token.shopId as string | null
        session.user.role = token.role as UserRole
      }
      return session
    },
  },
})

// 类型扩展：让 session.user 携带租户与角色信息
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      shopId: string | null
      role: UserRole
    } & DefaultSession['user']
  }

  interface User {
    shopId?: string | null
    role?: UserRole
    phone?: string
  }
}
