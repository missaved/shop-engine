import type { ReactNode } from 'react'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { getSetting } from '@/lib/platform-settings'
import zh from '@/messages/zh.json'
import zhHant from '@/messages/zh-Hant.json'
import en from '@/messages/en.json'
import vi from '@/messages/vi.json'
import ms from '@/messages/ms.json'
import th from '@/messages/th.json'

// 后台全动态：admin 树脱离 next-intl 中间件 + 依赖请求期 auth，禁止任何静态化
// （否则 presets 等无 DB 查询的页面被 on-demand 静态缓存，setRequestLocale 缺失 → getLocale 回退 defaultLocale en）
export const dynamic = 'force-dynamic'

// 每个语种对应的 messages。⚠️ 不用 getMessages()：admin 树脱离 intl 中间件，
// requestLocale 只在中间件侧产生，getMessages 在客户端导航/RSC 场景会拿到提前缓存的 defaultLocale(en)
// → server 中文 / client 英文「中英混杂」。此处按 URL locale 显式取 messages，client 端与 server 端必然一致。
const MESSAGES: Record<string, Record<string, any>> = {
  zh,
  'zh-Hant': zhHant,
  en,
  vi,
  ms,
  th,
}

// 页面标题按 locale 本地化（admin 根布局的硬编码中文 title 会被这里覆盖，消除 en 路径「平台运营后台」残留）
const TITLES: Record<string, string> = {
  zh: 'shop-engine · 平台运营后台',
  'zh-Hant': 'shop-engine · 平台營運後台',
  en: 'shop-engine · Platform Admin',
  vi: 'shop-engine · Quản trị nền tảng',
  ms: 'shop-engine · Pentadbiran Platform',
  th: 'shop-engine · ผู้ดูแลระบบ',
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  // Site 接线（2026-08-30）：设置中心 site.name 替换品牌前缀（保留 locale 后缀本地化）；
  // 未配置回退硬编码，不回归
  const site = await getSetting<{ name?: string }>('site')
  const name = site?.name?.trim()
  if (!name) return { title: TITLES[locale] ?? 'shop-engine' }
  const suffix = (TITLES[locale] ?? 'shop-engine').split('· ').slice(1).join('· ')
  return { title: suffix ? `${name} · ${suffix}` : name }
}

// admin 树 locale 层：校验 locale → 设 request locale → 加载该语言 messages。
// admin 段（/admin/{locale}）脱离 next-intl 的 locale 前缀中间件，必须在此显式 setRequestLocale，
// 否则 server 端 getTranslations/getLocale 拿不到 locale 上下文
export default async function AdminLocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)

  // 必须显式传 locale + 按 locale 的 messages：admin 树脱离 next-intl 中间件，
  // client 端若靠默认 locale 会回退 en，与 server 端 setRequestLocale 的 zh 不一致 → hydration mismatch / 语言混杂
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {children}
    </NextIntlClientProvider>
  )
}
