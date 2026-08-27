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

// 必须为店主：断言 shopId 非空 + role=OWNER，返回 shopId 收窄为 string 的 user。
// OWNER 单店场景统一用它（requireUser 的 shopId 已 nullable，直接拿去当 string 会 TS 报错）
export const requireOwner = cache(async () => {
  const user = await requireUser()
  if (!user.shopId || user.role !== 'OWNER') {
    const locale = await getLocale()
    redirect({ href: '/login', locale })
    throw new Error('unreachable: redirect did not throw')
  }
  return { ...user, shopId: user.shopId }
})

// 必须为平台运营：断言 role=ADMIN，否则踢回 /dashboard（OWNER 混入 /admin 时回自己后台）
export const requireAdmin = cache(async () => {
  const user = await requireUser()
  if (user.role !== 'ADMIN') {
    const locale = await getLocale()
    redirect({ href: '/dashboard', locale })
    throw new Error('unreachable: redirect did not throw')
  }
  return user
})
