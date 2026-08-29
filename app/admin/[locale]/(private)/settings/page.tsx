// 中台用户设置（ADMIN 专属）：2FA 开关 + 界面语言 + 层级管理预留
// requireAdmin + AdminShell 由 (private)/layout 统一处理；此处再读一次 me 取 totpEnabled 当前值
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { SettingsPanel } from '@/components/admin/settings-panel'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const t = await getTranslations('admin')
  const session = await requireAdmin()
  const me = await prisma.user.findUnique({ where: { id: session.id } })

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t('settingsTitle')}</h1>
        <p className="text-xs text-zinc-500">{t('settingsHint')}</p>
      </div>
      <SettingsPanel totpEnabled={me?.totpEnabled ?? false} />
    </div>
  )
}
