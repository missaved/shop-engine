'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { routing } from '@/i18n/routing'
import type { Locale } from '@/i18n/routing'

// 各语种「自称」（列表里展示用，便于顾客识别自己语言）
const LOCALE_NAMES: Record<string, string> = {
  zh: '简体中文',
  'zh-Hant': '繁體中文',
  en: 'English',
  vi: 'Tiếng Việt',
  ms: 'Bahasa Melayu',
  th: 'ไทย',
}

// 多语切换器（图标按钮 + 点击弹出语种列表；登录页/落地页/Boss/客户菜单/admin 通用）
// 双路径模式（第 20 批 admin 迁移后）：
//   admin 树 = /admin/{locale}/...（locale 在第 2 段，admin 在前）→ 替换 seg[2]
//   客户端树 = /{locale}/...（locale 在第 1 段）→ 替换 seg[1]
// locale 从 useParams 取（两棵树都有 {locale} 段），不依赖 next-intl 的 useLocale（admin 树无 locale 前缀中间件）
export function LocaleSwitcher() {
  const params = useParams<{ locale?: string }>()
  const locale = (params?.locale as Locale) ?? routing.defaultLocale
  const t = useTranslations('admin')
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 点击弹出框外部 → 关闭（轻量下拉，不引额外依赖）
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function switchTo(loc: Locale) {
    // 标记用户已手动选择语种：会话级 sessionStorage + 跨会话 cookie，
    // 供 ClientLocaleAuto 识别「用户主动选择」并停止自动跳转
    sessionStorage.setItem('locale-picked', '1')
    document.cookie = 'locale-picked=1; path=/; max-age=31536000'
    const qs = window.location.search
    if (pathname.startsWith('/admin')) {
      // admin 树：/admin/{locale}/... → 替换 locale 段
      const seg = pathname.split('/')
      seg[2] = loc
      router.replace(seg.join('/') + qs)
    } else {
      // 客户端树：/{locale}/... → 替换 locale 段
      const seg = pathname.split('/')
      seg[1] = loc
      router.replace(seg.join('/') + qs)
    }
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('switchLocale')}
        title={t('switchLocale')}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none transition-colors hover:bg-black/5 dark:hover:bg-white/10"
      >
        🌐
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[9rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {routing.locales.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => switchTo(loc)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                loc === locale
                  ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <span>{LOCALE_NAMES[loc] ?? loc}</span>
              {loc === locale && <span className="text-amber-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
