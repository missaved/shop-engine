// Auth.js v5 配置：Credentials（手机号+密码）+ JWT session
// session 里注入 shopId / role，供 DAL 做租户隔离与授权
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import Facebook from 'next-auth/providers/facebook'
import { CredentialsSignin } from 'next-auth'
import type { DefaultSession } from 'next-auth'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/phone'
import {
  ADMIN_LIMIT_OPTS,
  clearFailures,
  clientIp,
  isRateLimited,
  recordFailure,
} from '@/lib/rate-limit'
import type { RateLimitOpts } from '@/lib/rate-limit'
import { getSetting } from '@/lib/platform-settings'
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

// 第 21 批（2026-08-29 用户拍板）：登录失败锁定。锁定期间登录直接拒绝（含正确密码），后台 unlockUser 解锁
class AccountLockedSignin extends CredentialsSignin {
  code = 'ACCOUNT_LOCKED'
}

// 2FA 强制（设置项 totpForce，默认关）：开时 admin 未绑定 TOTP → 拒绝登录并引导绑定
class NeedTotpSetupSignin extends CredentialsSignin {
  code = 'NEED_TOTP_SETUP'
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 }, // 会话 7 天过期（显式生命周期，替换默认 30 天）
  trustHost: true, // 局域网 IP 访问时信任 host，否则报 UntrustedHost
  // Secure cookie 按环境区分（P2-D）：生产 Vercel(https)=true 走安全 cookie；
  // 本地(无 VERCEL)保持 false —— 局域网 http/IP(192.168.5.210:3000) 不发送 Secure cookie，否则登录必 MissingCSRF。
  // 本地即使经隧道 https 访问，不设 Secure 也不崩（cookie 只在 http 下受限），统一按 VERCEL 判，最稳。
  useSecureCookies: process.env.VERCEL === '1',
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
        // 平台安全配置（2026-08-29 接线）：登录失败锁定阈值/时长、2FA 强制、admin 限流阈值均可配，默认值 = 既有常量
        const security = (await getSetting<{
          rateLimitMax?: number
          rateLimitWindowMin?: number
          accountLockThreshold?: number
          accountLockMinutes?: number
          totpForce?: boolean
        }>('security')) ?? {}
        const lockThreshold = security.accountLockThreshold ?? 5
        const lockMinutes = security.accountLockMinutes ?? 15
        // admin 档限流可配：max/window 读配置，历史累计与封禁保持默认（防削弱，只放开窗口维度）
        const limitOpts: RateLimitOpts | undefined = isAdmin
          ? {
              max: security.rateLimitMax ?? ADMIN_LIMIT_OPTS.max,
              windowMs:
                (security.rateLimitWindowMin ?? ADMIN_LIMIT_OPTS.windowMs / 60_000) *
                60_000,
              historyMs: ADMIN_LIMIT_OPTS.historyMs,
              historyMax: ADMIN_LIMIT_OPTS.historyMax,
              banMs: ADMIN_LIMIT_OPTS.banMs,
            }
          : undefined
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

        // 登录失败锁定（用户拍板 2026-08-29）：锁定期内直接拒绝（含正确密码），后台 unlockUser 解锁
        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          throw new AccountLockedSignin()
        }

        const ok = await compare(password, user.passwordHash)
        if (!ok) {
          recordFailure(ipKey, limitOpts)
          recordFailure(phoneKey, limitOpts)
          // 失败累计锁定：failedAttempts+1，达阈值 → 置 lockedUntil = now + lockMinutes（可配）
          const fails = (user.failedAttempts ?? 0) + 1
          const locked = fails >= lockThreshold
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedAttempts: fails,
              lockedUntil: locked
                ? new Date(Date.now() + lockMinutes * 60_000)
                : null,
            },
          })
          return null
        }

        // 第 20 批 A3 + 审计修复：clearFailures 延迟到「完全登录成功」才执行。
        // 原「密码通过即清」会让连续错 otp 时每次先被清空，验证码爆破防护形同虚设（补测抓到）。
        // 现语义：密码错 / otp 错都累计；NEED_TOTP（密码对但缺 otp，正常第一步）不记；全对登录成功才清。
        // 2FA 强制（2026-08-29 用户拍板默认关，本期不启用拦截）：totpForce=true 时 admin 未绑定 TOTP → 拒绝登录并引导绑定；
        // 已绑定用户走下方常规 TOTP 校验；默认关零拦截（测试验证方便，后期正式运营再开启）
        if (user.role === 'ADMIN' && security.totpForce && !user.totpEnabled) {
          throw new NeedTotpSetupSignin()
        }
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
        // 登录失败锁定：成功登录清零累计（防历史失败把正常登录误锁）
        if (user.failedAttempts || user.lockedUntil) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedAttempts: 0, lockedUntil: null },
          })
        }

        return {
          id: user.id,
          name: user.name ?? user.phone,
          phone: user.phone,
          shopId: user.shopId,
          role: user.role,
        }
      },
    }),
    // 客户账号 provider（M6a）：手机号+密码，authorize 查 Customer 表。
    // 与 owner/admin 完全隔离（Customer 独立表，不动 UserRole 枚举）；登录不限流（MVP 从简，
    // 客户账号非关键资源，后续按需接 rate-limit）。登录不强制：低门槛客户走匿名查询（6.3b）
    Credentials({
      id: 'customer-credentials',
      name: 'customer',
      credentials: {
        phone: { label: 'Phone', type: 'tel' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        const phone = normalizePhone(
          typeof credentials?.phone === 'string' ? credentials.phone : '',
        )
        const password =
          typeof credentials?.password === 'string' ? credentials.password : ''
        if (!phone || !password) return null
        const customer = await prisma.customer.findUnique({ where: { phone } })
        if (!customer) return null
        // 身份融合（2026-08-31）：passwordHash 可空（纯 OAuth 客户无密码）——密码登录仅支持有密码客户
        if (!customer.passwordHash) return null
        const ok = await compare(password, customer.passwordHash)
        if (!ok) return null
        return {
          id: customer.id,
          name: customer.name ?? customer.phone ?? customer.username,
          phone: customer.phone ?? undefined,
          role: 'CUSTOMER',
        }
      },
    }),
    // 顾客 OAuth 主通道（用户拍板 2026-08-31「本期做 FB/Google」）：显式传 env，不走 AUTH_ 隐式前缀
    // （避免与老板实例共享 env 的魔术映射）；未配置 → 该 provider 不加入，零崩溃。
    // profile() 必须显式返回 { id: Customer.id, role: 'CUSTOMER' }（plan 审辩 A3）：
    // 否则 Google/FB 默认只返回 provider sub + 无 role → jwt 走 else 分支、token.customerId 永不写 → 身份融合静默失效。
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            async profile(profile) {
              const providerId = String(profile.sub ?? '')
              const customer = await prisma.customer.upsert({
                where: { provider_providerId: { provider: 'google', providerId } },
                create: {
                  provider: 'google',
                  providerId,
                  name: profile.name ?? null,
                  email: profile.email ?? null,
                  image: profile.picture ?? null,
                },
                update: {
                  name: profile.name ?? undefined,
                  email: profile.email ?? undefined,
                  image: profile.picture ?? undefined,
                },
              })
              return {
                id: customer.id,
                name: customer.name ?? customer.phone ?? customer.username ?? undefined,
                email: customer.email ?? undefined,
                image: customer.image ?? undefined,
                role: 'CUSTOMER',
              }
            },
          }),
        ]
      : []),
    ...(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET
      ? [
          Facebook({
            clientId: process.env.FACEBOOK_CLIENT_ID,
            clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
            async profile(profile) {
              const providerId = String(profile.id ?? '')
              const customer = await prisma.customer.upsert({
                where: { provider_providerId: { provider: 'facebook', providerId } },
                create: {
                  provider: 'facebook',
                  providerId,
                  name: profile.name ?? null,
                  email: profile.email ?? null,
                  image: profile.picture?.data?.url ?? null,
                },
                update: {
                  name: profile.name ?? undefined,
                  email: profile.email ?? undefined,
                  image: profile.picture?.data?.url ?? undefined,
                },
              })
              return {
                id: customer.id,
                name: customer.name ?? customer.phone ?? customer.username ?? undefined,
                email: customer.email ?? undefined,
                image: customer.image ?? undefined,
                role: 'CUSTOMER',
              }
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        if (user.role === 'CUSTOMER') {
          // 客户会话：写 customerId + phone（认领用 ownerPhone 匹配），不碰 shopId（owner/admin 分支不受影响）
          token.customerId = user.id
          token.phone = user.phone
          token.role = 'CUSTOMER'
        } else if (user.role === 'OWNER' || user.role === 'ADMIN') {
          token.shopId = user.shopId
          token.role = user.role
        }
        // 其它（如未来 provider 漏传 role）不写任何身份，避免误写 shopId/role（plan A3 兜底）
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.sub ?? '') as string
        if (token.customerId) {
          // 客户会话：注入 customerId + phone + role='CUSTOMER'
          session.user.customerId = token.customerId as string
          session.user.phone = token.phone as string
          session.user.role = 'CUSTOMER'
        } else {
          session.user.shopId = token.shopId as string | null
          session.user.role = token.role as UserRole
        }
      }
      return session
    },
  },
})

// 类型扩展：让 session.user 携带租户与角色信息（M6a 加 customerId + CUSTOMER 角色）
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      shopId: string | null
      customerId?: string
      role: UserRole | 'CUSTOMER'
    } & DefaultSession['user']
  }

  interface User {
    shopId?: string | null
    role?: UserRole | 'CUSTOMER'
    phone?: string
  }
}
