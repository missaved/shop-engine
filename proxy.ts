// Next 16 中 Middleware 更名为 Proxy：负责按 Accept-Language 重定向到 /[locale]，
// 并在带 locale 的路径下直接放行（next-intl 的 createMiddleware）
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  // 跳过 api/静态资源/内部路径，其余（含根路径 /）交给 next-intl 处理 locale
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
}
