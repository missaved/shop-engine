import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  // 局域网访问：Next dev 默认拦截非 localhost 的 /_next 资源（403，防 DNS rebinding），
  // 放开常见私有网段，保证手机通过局域网 IP 访问时 hydration 正常（改后需重启 dev）。
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*'],
}

export default withNextIntl(nextConfig)
