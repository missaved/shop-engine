// 中央 URL 工厂：消灭散落的 `/s/{slug}` 字符串与 window.location.origin 拼接。
// 本文件**禁止查 DB**（会被 client component 用）；产物默认**裸路径**（不带 locale），
// 需要 locale 用 localizedUrl；二维码/分享等外部绝对链接用 absoluteUrl（原生不带 locale，交给 proxy 按浏览器语言适配）。
import type { Locale } from '@/i18n/routing'
import type { Vertical } from './vertical'
import { verticalSlug } from './vertical'

export interface ShopUrlRef {
  vertical: Vertical
  slug: string
}

/** 单店裸入口：/food/x （food=菜单根；moto 等垂直的落地子路径用 shopSubUrl 显式带 sub） */
export function shopUrl(ref: ShopUrlRef): string {
  return `/${verticalSlug(ref.vertical)}/${ref.slug}`
}

/** 单店子页裸路径：/food/x/track?orderNo=1 （sub 含 ticket/{ticketId} 等带参段）。
 *  sub='' 表示单店根入口（/food/x?type=..），不产生尾斜杠。 */
export function shopSubUrl(
  ref: ShopUrlRef,
  sub: string,
  params?: Record<string, string | number | undefined>,
): string {
  const base = sub ? `${shopUrl(ref)}/${sub}` : shopUrl(ref)
  if (!params) return base
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return qs ? `${base}?${qs}` : base
}

/** 垂直聚合页（分类页）：/food */
export function verticalUrl(vertical: Vertical): string {
  return `/${verticalSlug(vertical)}`
}

/** 给裸路径加 locale 前缀：/food/x → /zh/food/x。服务端 redirect / 需固定语言用。 */
export function localizedUrl(path: string, locale: Locale): string {
  return `/${locale}${path}`
}

/** 拼绝对链接（二维码/分享）。默认取 window.location.origin，可显式传 origin（服务端/测试）。 */
export function absoluteUrl(path: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}${path}`
}
