// Admin 全做（第 20 批）：预设单类详情页 —— 图片网格逐张审核（剔除 / 改 prompt 重生成单图）
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { requireAdmin } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { FOOD_SUBCATEGORIES } from '@/lib/llm/prompts'
import { PresetGrid, type GridItem } from '@/components/admin/preset-grid'
import { PLACEHOLDER_URL } from '@/lib/llm/image'
import { resolveImageUrl } from '@/lib/storage'

// 页面级 force-dynamic：依赖 FoodPreset 最新 items（剔除/重生成后刷新可见）
export const dynamic = 'force-dynamic'

export default async function AdminPresetDetailPage({
  params,
}: {
  params: Promise<{ locale: string; subcategory: string }>
}) {
  const { locale, subcategory } = await params
  await requireAdmin()
  const t = await getTranslations('admin')

  const meta = FOOD_SUBCATEGORIES[subcategory]
  // Admin「新增品类」：自定义类名从 PresetCategory 读（静态 35 类之外）
  const [preset, cat] = await Promise.all([
    prisma.foodPreset.findFirst({ where: { country: 'VN', subcategory } }),
    prisma.presetCategory.findUnique({ where: { key: subcategory } }),
  ])
  // 多语言修复（2026-08-29 用户报「菜品名是越南文」）：FoodPreset item 字段是 name_zh/name_en，
  // GridItem 期望 nameZh/nameEn——直接 cast 永远匹配不上，中文名从不显示。这里做显式映射。
  const items = (((preset?.items as unknown[]) ?? []) as Record<string, unknown>[]).map((it) => ({
    nativeName: String(it.nativeName ?? ''),
    nameZh: String(it.name_zh ?? ''),
    nameEn: String(it.name_en ?? ''),
    defaultPrice: Number(it.defaultPrice ?? 0),
    imageUrl: resolveImageUrl(String(it.imageUrl ?? '')),
    imagePrompt: String(it.imagePrompt ?? ''),
  }))
  const title = meta ? `${meta.vi} · ${meta.zh}` : cat ? `${cat.nameVi} · ${cat.nameZh}` : subcategory

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-xs text-zinc-500">
            {subcategory} · {items.length} {t('presetDishes')}
          </p>
        </div>
        <Link
          href={`/admin/${locale}/presets`}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {t('presetBack')}
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">{t('presetEmpty')}</p>
      ) : (
        <PresetGrid
          subcategory={subcategory}
          cuisine={preset?.cuisine ?? meta?.cuisine ?? cat?.cuisine ?? 'vn'}
          placeholderUrl={PLACEHOLDER_URL}
          items={items}
          currency="VND"
        />
      )}
    </div>
  )
}
