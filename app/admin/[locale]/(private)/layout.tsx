import { requireAdmin } from '@/lib/dal'
import { AdminShell } from '@/components/admin/admin-shell'
import { getSetting } from '@/lib/platform-settings'

// admin 后台统一外壳（第 20 批 A5）：requireAdmin 覆盖全部子页，未登录踢去 /admin/{locale}/login
// 2FA 改为「设置页开关」（第 20 批复测）：不再强制绑定踢去 setup-totp；开启与否在登录时由 NEED_TOTP 判定
// Site 接线（2026-08-30）：站点信息 site.name/logoUrl 传给顶栏品牌；未配置走组件内 i18n fallback
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  const site = await getSetting<{ name?: string; logoUrl?: string }>('site')
  return (
    <AdminShell siteName={site?.name ?? null} siteLogo={site?.logoUrl ?? null}>
      {children}
    </AdminShell>
  )
}
