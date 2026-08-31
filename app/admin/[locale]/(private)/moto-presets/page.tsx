import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/dal'
import { listMotoPresets } from '@/lib/moto-preset-actions'
import { MotoPresetManager } from '@/components/admin/moto-preset-manager'

// M4.4 中台 moto 预设库（MotoPreset 独立页，不复用/并入 food presets 页，数据结构不同）
// force-dynamic：本页有 DB 查询，禁用静态缓存（防 getLocale 回退 defaultLocale）
export const dynamic = 'force-dynamic'

export default async function AdminMotoPresetsPage() {
  await requireAdmin()
  const t = await getTranslations('admin')
  const presets = await listMotoPresets()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('mpTitle')}</h1>
        <p className="text-sm text-zinc-500">{t('mpHint')}</p>
      </div>
      <MotoPresetManager initial={presets} />
    </div>
  )
}
