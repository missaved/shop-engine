// Auth.js v5 配置：Credentials（手机号+密码）+ JWT session
// session 里注入 shopId / role，供 DAL 做租户隔离与授权
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { CredentialsSignin } from 'next-auth'
import type { DefaultSession } from 'next-auth'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import {
  clearFailures,
  clientIp,
  isRateLimited,
  recordFailure,
} from '@/lib/rate-limit'
import type { UserRole } from '@/generated/prisma/enums'

// 登录限流专用错误：继承 CredentialsSignin，用 code 区分（客户端 signIn 返回 res.code）
class RateLimitedSignin extends CredentialsSignin {
  code = 'RATE_LIMITED'
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 }, // 会话 7 天过期（显式生命周期，替换默认 30 天）
  trustHost: true, // 局域网 IP 访问时信任 host，否则报 UntrustedHost
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        phone: { label: 'Phone', type: 'tel' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials, request) => {
        const phone =
          typeof credentials?.phone === 'string' ? credentials.phone : ''
        const password =
          typeof credentials?.password === 'string' ? credentials.password : ''
        if (!phone || !password) return null

        // 登录限流：IP + 手机号双维度，5 次失败/60s 后临时锁定（防爆破）
        const ip = clientIp(request)
        if (isRateLimited(`ip:${ip}`) || isRateLimited(`phone:${phone}`)) {
          throw new RateLimitedSignin()
        }

        const user = await prisma.user.findUnique({ where: { phone } })
        if (!user) {
          recordFailure(`ip:${ip}`)
          recordFailure(`phone:${phone}`)
          return null
        }

        const ok = await compare(password, user.passwordHash)
        if (!ok) {
          recordFailure(`ip:${ip}`)
          recordFailure(`phone:${phone}`)
          return null
        }

        clearFailures(`ip:${ip}`)
        clearFailures(`phone:${phone}`)

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
