'use client'
// Food 菜单页头登录徽章（OAuth 主通道入口）：未登录 → 「登录」；已登录 → 首字母色块 + 名字 + 退出。
// 只写身份不强制：游客照常逛菜单/匿名下单（见 TASK_PLAN「下单不强制」定案），徽章是入口不是门槛。
// 载体 = 主实例 /api/auth（与老板同 basePath），signIn() 走 POST+CSRF（next-auth v5 禁 GET 启动，GET 锚点已作废）。
import { signIn, signOut } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { shopSubUrl, localizedUrl } from '@/lib/urls'
import type { Vertical } from '@/lib/vertical'
import type { CitySlug } from '@/lib/city'
import type { Locale } from '@/i18n/routing'

const btn =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm font-medium transition-colors dark:border-zinc-700'
const dim =
  'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'

export function CustomerAuthBadge({
  vertical,
  slug,
  city,
  isLoggedIn,
  customerName,
}: {
  vertical: Vertical
  slug: string
  city: CitySlug
  isLoggedIn: boolean
  customerName: string | null
}) {
  // 登录态 UI 延迟到客户端挂载后再渲染：避免「SSR 读 session 渲染名字」与「CSR 首帧同名值」
  // 在复杂菜单页的 hydration 差异（React #441，异步态常触发的 text mismatch）。
  // SSR 与 CSR 首帧都渲染「登录」按钮（一致）→ 挂载后再切换为名字/退出，杜绝 text mismatch。
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const t = useTranslations('customer')
  const locale = useLocale()
  // 回调菜单根路径（裸路径 + locale）。signIn 会自行编码/解析 callbackUrl，这里传未编码本地路径。
  const cb = localizedUrl(shopSubUrl({ vertical, slug, city }, ''), locale as Locale)

  if (isLoggedIn && mounted) {
    // 首字母色块头像（不渲染外部头像：镜像 CSP img-src 拦截 lh3.googleusercontent 的先例）
    const initial = (customerName ?? '').trim().charAt(0).toUpperCase() || '?'
    return (
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-white">
          {initial}
        </span>
        {customerName && (
          <span className="hidden max-w-24 truncate text-sm text-zinc-500 dark:text-zinc-400 sm:inline">
            {customerName}
          </span>
        )}
        <button type="button" onClick={() => signOut()} className={`${btn} ${dim}`}>
          {t('signOut')}
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => signIn('google', { callbackUrl: cb })}
      className={`${btn} ${dim}`}
    >
      {t('login')}
    </button>
  )
}
