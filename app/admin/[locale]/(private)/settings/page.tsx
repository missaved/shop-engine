// 中台设置中心（ADMIN 专属）：4 组 Tab × 13 块（站点/AI/社交/安全/维护/通知/入驻/计费/套餐/公告/APIkey/审计 + 2FA/语言）
// requireAdmin + AdminShell 由 (private)/layout 统一处理；数据 getSettingsData() 一次性传入（脱敏视图）
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { getSettingsData } from '@/lib/admin-settings-actions'
import { SettingsPanel } from '@/components/admin/settings-panel'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const t = await getTranslations('admin')
  const session = await requireAdmin()
  // 并行取：当前 admin 的 totpEnabled（2FA 块）+ 全部设置数据（脱敏）
  const [me, data] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.id } }),
    getSettingsData(),
  ])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t('settingsTitle')}</h1>
        <p className="text-xs text-zinc-500">{t('settingsHint')}</p>
      </div>
      <SettingsPanel data={data} totpEnabled={me?.totpEnabled ?? false} />
    </div>
  )
}
