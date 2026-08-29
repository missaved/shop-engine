import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { FOOD_SUBCATEGORIES } from '@/lib/llm/prompts'
import { PresetList, type PresetRow } from '@/components/admin/preset-list'
import { CreatePresetCategory } from '@/components/admin/preset-create-category'

// 预设库（第 19 批 A5）：FoodPreset 只读展示 + 启用禁用 + 后台预生成触发（preset-actions.ts）
// force-dynamic：本页有 DB 查询，禁用静态缓存（防 getLocale 回退 defaultLocale）
export const dynamic = 'force-dynamic'

export default async function AdminPresetsPage() {
  await requireAdmin()
  const t = await getTranslations('admin')

  // 第 20 批 Admin「新增品类」：静态 35 类 + DB PresetCategory 自定义类合并展示
  const [presets, categories] = await Promise.all([
    prisma.foodPreset.findMany({ where: { country: 'VN' } }),
    prisma.presetCategory.findMany({ where: { active: true } }),
  ])
  const bySub = new Map(presets.map((p) => [p.subcategory, p]))

  const staticRows: PresetRow[] = Object.entries(FOOD_SUBCATEGORIES).map(([key, meta]) => {
    const p = bySub.get(key)
    return {
      subcategory: key,
      name: `${meta.vi} · ${meta.zh}`,
      cuisine: meta.cuisine,
      exists: !!p,
      active: p?.active ?? false,
      itemCount: p ? (p.items as unknown[]).length : 0,
      modelUsed: p?.modelUsed ?? null,
      generatedAt: p?.updatedAt ?? null,
    }
  })
  const customRows: PresetRow[] = categories.map((c) => {
    const p = bySub.get(c.key)
    return {
      subcategory: c.key,
      name: `${c.nameVi} · ${c.nameZh}`,
      cuisine: c.cuisine as PresetRow['cuisine'],
      exists: !!p,
      active: p?.active ?? false,
      itemCount: p ? (p.items as unknown[]).length : 0,
      modelUsed: p?.modelUsed ?? null,
      generatedAt: p?.updatedAt ?? null,
    }
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('presetsTitle')}</h1>
          <p className="text-sm text-zinc-500">{t('presetsHint')}</p>
        </div>
        <CreatePresetCategory />
      </div>
      <PresetList rows={[...staticRows, ...customRows]} />
    </div>
  )
}
