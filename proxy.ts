// Next 16 中 Middleware 更名为 Proxy。
// 主路径（客户 /{locale}/{vertical}/{slug}/...、boss /dashboard 等）走 next-intl 的 locale 前缀逻辑（/{locale}/...）；
// admin 段（SaaS 管理后台，管理员电脑用）独立处理：admin 在前、locale 在后（/admin/{locale}/...），
// 脱离 next-intl 的 locale 前缀重定向，由 app/admin/[locale] 路由自己读 locale（第 20 批定案）。
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const intl = createMiddleware(routing)

// 已带 locale 的 admin 路径（如 /admin/zh/login）→ 原样放行，不重定向
const ADMIN_LOCALE_START = /^\/admin\/(zh|zh-Hant|en|vi|ms|th)(\/|$)/

// HSTS 仅对生产域名 spotnear.me（及其子域，HTTPS 反代/隧道）生效；
// 局域网 http 内测不加，避免浏览器收到 HSTS 后强制跳 https 导致内测不可用
function withHSTS(res: Response, host: string): Response {
  if (host === 'spotnear.me' || host.endsWith('.spotnear.me')) {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  return res
}

export default function proxy(request: NextRequest) {
  const host = request.headers.get('host') ?? ''
  const { pathname } = new URL(request.url)

  // admin 段：管理端 admin 在前、locale 在后。/admin、/admin/login 等无 locale 的入口
  // → 307 默认中文 /admin/zh/(...)，其余 /admin/{locale}/** 放行
  // 注意：middleware 里 NextResponse.redirect 必须绝对 URL（相对路径报 URL malformed）
  if (pathname.startsWith('/admin')) {
    if (!ADMIN_LOCALE_START.test(pathname)) {
      // 去掉 /admin 前缀，拼到 /admin/zh 后面（/admin → /admin/zh，/admin/login → /admin/zh/login）
      const tail = pathname === '/admin' ? '' : pathname.slice('/admin'.length)
      return withHSTS(NextResponse.redirect(new URL(`/admin/zh${tail}`, request.url), 307), host)
    }
    // 注入 admin locale 头：admin 树脱离 intl 中间件（无 Next-Locale 头），服务端 request config 借此按 URL locale 解析。
    // 不这样做，客户端导航 / 全页加载下 getConfig 可能按 defaultLocale(en) 缓存 → 服务端文案「中英混杂」。
    // 用 NextResponse.next 显式带修改后的头放行（与返回 undefined 等效，但能带自定义头）
    const m = pathname.match(/^\/admin\/(zh|zh-Hant|en|vi|ms|th)(\/|$)/)
    const requestHeaders = new Headers(request.headers)
    if (m) requestHeaders.set('x-admin-locale', m[1])
    return withHSTS(NextResponse.next({ request: { headers: requestHeaders } }), host)
  }

  const response = intl(request)
  if (!response) return undefined
  return withHSTS(response, host)
}

export const config = {
  // 跳过 api/静态资源/内部路径，其余（含根路径 /）交给上面逻辑处理
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
}
