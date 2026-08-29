import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

// 第 20 批 A6：安全响应头（仅生产生效）。CSP 需放行 Next RSC 内联脚本 + React 内联样式；
// dev 不加，保留 sourcemap/eval 开发自由；HSTS 由 proxy.ts 按 host 判断（避免局域网 http 被强制 https）
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join('; '),
}

const nextConfig: NextConfig = {
  // 局域网访问：Next dev 默认拦截非 localhost 的 /_next 资源（403，防 DNS rebinding），
  // 放开常见私有网段，保证手机通过局域网 IP 访问时 hydration 正常（改后需重启 dev）。
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*'],
  ...(process.env.NODE_ENV === 'production'
    ? {
        async headers() {
          return [
            {
              source: '/:path*',
              headers: Object.entries(securityHeaders).map(([key, value]) => ({
                key,
                value,
              })),
            },
          ]
        },
      }
    : {}),
}

export default withNextIntl(nextConfig)
