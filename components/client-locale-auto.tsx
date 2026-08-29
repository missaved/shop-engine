'use client'

// 浏览器语言自动适配：挂载时按 navigator 首选语言跳到对应站点语种。
// 仅首访生效：用户手动切过语种（sessionStorage 标记）或 cookie 已记录既有选择时跳过，
// 且无法匹配的语种（fr/ko/id 等）不跳转，尊重深链/URL 语种，勿把客户从 /vi 菜单弹走。
// 必须挂在 NextIntlClientProvider 内（layout 内），navigator/sessionStorage/document 只在 useEffect 访问。
import { useEffect } from 'react'
import { useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'

// BCP47 前缀映射（忽略大小写，先判 zh-Hant 脚本再判 zh-*）
function detectBrowserLocale(): Locale | null {
  const navLangs = navigator.languages ?? [navigator.language]
  const first = navLangs[0] ?? navigator.language
  if (!first) return null
  const base = first.toLowerCase()

  if (base.includes('hant')) return 'zh-Hant'
  if (base.startsWith('zh')) return 'zh'
  if (base.startsWith('vi')) return 'vi'
  if (base.startsWith('en')) return 'en'
  if (base.startsWith('ms')) return 'ms'
  if (base.startsWith('th')) return 'th'
  return null
}

export function ClientLocaleAuto() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // 用户手动切过语种（本会话标记 + 跨会话 cookie）→ 不再自动跳转。
    // 注意不能用 next-intl 自动写入的 NEXT_LOCALE cookie 判断「用户选择」——
    // 访问任意 locale 页面它都会被写成当前 locale，会误拦截首访自动识别。
    if (sessionStorage.getItem('locale-picked') === '1') return
    if (/;?\s*locale-picked=1/.test(document.cookie)) return

    const target = detectBrowserLocale()
    // 与当前语种不同才跳转；保留 query（?table / ?orderNo / ?page 等）
    if (target && target !== locale) {
      router.replace(pathname + window.location.search, { locale: target })
    }
  }, [locale, pathname, router])

  return null
}
