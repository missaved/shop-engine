// next-intl 请求配置：按当前 locale 加载对应 messages
import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { headers } from 'next/headers'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  let locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale

  // admin 树（/admin/{locale}/...）脱离 intl 中间件，requestLocale 可能缺失/回退 defaultLocale(en)。
  // proxy 为 admin 路径注入 x-admin-locale 头（URL locale 权威），服务端 getTranslations/getMessages/getLocale
  // 借此稳定解析——否则客户端导航/全页加载下 getConfig 按缓存时序偶发 en，出现「中英混杂」。
  // 客户端树（/{locale}/...）无此头，走 requestLocale（中间件设置），不受影响。
  const h = await headers()
  const adminLocale = h.get('x-admin-locale')
  if (adminLocale && hasLocale(routing.locales, adminLocale)) locale = adminLocale

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
