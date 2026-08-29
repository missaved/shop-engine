import { requireAdmin } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { AdminTotpSetup } from '@/components/admin/totp-setup'

// admin 首次登录绑定 TOTP 引导页（第 20 批 A4）：requireAdmin + 未绑定才可访问，已绑定回 /admin
// locale 直接用 URL params（admin 树脱离 intl 中间件，getLocale() 可能回退 en 导致跳错语言）
export default async function AdminTotpSetupPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await requireAdmin()
  const me = await prisma.user.findUnique({ where: { id: session.id } })
  if (me?.totpEnabled) {
    redirect(`/admin/${locale}`)
    throw new Error('unreachable: redirect did not throw')
  }
  return <AdminTotpSetup />
}
