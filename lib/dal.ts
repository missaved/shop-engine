// 数据访问层（DAL）：集中会话校验与当前用户获取
// 所有 server action / 数据查询都从这里拿当前租户，杜绝忘校验
import 'server-only'
import { cache } from 'react'
import { auth } from '@/auth'
import { getLocale } from 'next-intl/server'
import { redirect as intlRedirect } from '@/i18n/navigation'
import { redirect } from 'next/navigation'

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
    intlRedirect({ href: '/login', locale })
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
    intlRedirect({ href: '/login', locale })
    throw new Error('unreachable: redirect did not throw')
  }
  return { ...user, shopId: user.shopId }
})

// 必须为平台运营：断言 role=ADMIN。
// admin 树（app/admin/{locale}）脱离 next-intl 中间件，这里独立处理：
// 未登录 / 非 ADMIN 都去 /admin/{locale}/login（admin 专属两步登录，第 20 批 A4），
// 不复用 requireUser 的 /login（那是 boss 客户端登录页）
export const requireAdmin = cache(async () => {
  const user = await getCurrentUser()
  if (!user || user.role !== 'ADMIN') {
    const locale = await getLocale()
    redirect(`/admin/${locale}/login`)
    throw new Error('unreachable: redirect did not throw')
  }
  return user
})
