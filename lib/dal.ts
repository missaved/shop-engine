// 数据访问层（DAL）：集中会话校验与当前用户获取
// 所有 server action / 数据查询都从这里拿当前租户，杜绝忘校验
import 'server-only'
import { cache } from 'react'
import { auth } from '@/auth'
import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'

// 当前登录用户（未登录返回 null），React cache 保证单次渲染只查一次
export const getCurrentUser = cache(async () => {
  const session = await auth()
  return session?.user ?? null
})

// 必须登录：未登录则重定向到 /login（保持当前 locale）
export const requireUser = cache(async () => {
  const user = await getCurrentUser()
  if (!user) {
    const locale = await getLocale()
    redirect({ href: '/login', locale })
    // redirect 返回 never，但 next-intl 复杂条件类型下 TS 无法自动收窄，此处显式收窄
    throw new Error('unreachable: redirect did not throw')
  }
  return user
})
