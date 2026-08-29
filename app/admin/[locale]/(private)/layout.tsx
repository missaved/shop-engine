import { requireAdmin } from '@/lib/dal'
import { AdminShell } from '@/components/admin/admin-shell'

// admin 后台统一外壳（第 20 批 A5）：requireAdmin 覆盖全部子页，未登录踢去 /admin/{locale}/login
// 2FA 改为「设置页开关」（第 20 批复测）：不再强制绑定踢去 setup-totp；开启与否在登录时由 NEED_TOTP 判定
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return <AdminShell>{children}</AdminShell>
}
