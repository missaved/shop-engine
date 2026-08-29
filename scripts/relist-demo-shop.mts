// demo 店清空重新上架（2026-08-29 用户授权「清空重新上架」「随便整」）
// 复刻 preset-actions.saveShopDraft（自动归类注入 categoryI18n）+ publishShopDraft（清空重建 Product）
// 用法：pnpm tsx scripts/relist-demo-shop.mts [sub...]   # 默认 pho com banh-mi rice-cn bbq-cn cn-drinks
// 前置：cn-drinks 已生成（FoodPreset 有数据），否则该类被跳过。
import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { FOOD_SUBCATEGORIES } from '../lib/llm/prompts'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const phone = '0901234567'

type PresetDishItem = {
  nativeName: string
  name_zh?: string
  name_en?: string
  description_local?: string
  description_zh?: string
  description_en?: string
  defaultPrice: number
  unit?: string
  unit_zh?: string
  extras?: string[]
  extras_zh?: string[]
  optionGroups?: { name: string; nameZh?: string; options: { name: string; nameZh?: string; price: number }[] }[]
  allergens?: string[]
  dietaryTags?: string[]
  imageUrl?: string
  categoryI18n?: { vi: string; zh: string; en: string }
}

function buildProductConfig(it: PresetDishItem & { categoryI18n?: { vi: string; zh: string; en: string } }) {
  return {
    image: it.imageUrl?.trim() ?? '',
    emoji: '🍽️',
    nameI18n: { vi: it.nativeName, zh: it.name_zh ?? '', en: it.name_en ?? '' },
    descI18n: { vi: it.description_local ?? '', zh: it.description_zh ?? it.description_local ?? '', en: it.description_en ?? '' },
    unitI18n: { vi: it.unit ?? '', zh: it.unit_zh ?? '', en: '' },
    categoryI18n: it.categoryI18n ?? {},
    extras: (it.extras ?? []).map((n, i) => ({ name: n, nameZh: it.extras_zh?.[i] ?? '', price: 0 })),
    optionGroups: (it.optionGroups ?? []).map((g) => ({
      name: g.name,
      nameZh: g.nameZh ?? '',
      options: (g.options ?? []).map((o) => ({ name: o.name, nameZh: o.nameZh ?? '', price: o.price ?? 0 })),
    })),
    combo: [],
    bestseller: false,
    canAddOn: true,
    dietaryTags: it.dietaryTags ?? [],
    allergens: it.allergens ?? [],
  }
}

async function main() {
  const user = await prisma.user.findUnique({ where: { phone } })
  if (!user?.shopId) throw new Error(`phone=${phone} 无 shopId`)
  const shopId = user.shopId

  const args = process.argv.slice(2)
  const subs = args.length ? args : ['pho', 'com', 'banh-mi', 'rice-cn', 'bbq-cn', 'cn-drinks']

  const presets = await prisma.foodPreset.findMany({
    where: { country: 'VN', subcategory: { in: subs }, active: true },
  })
  const found = new Set(presets.map((p) => p.subcategory))
  console.log(`选中 ${subs.length} 类，实际有预设 ${presets.length} 类；缺失：${subs.filter((s) => !found.has(s)).join(', ') || '无'}`)

  // 自动归类：categoryI18n = 子分类三语名
  const customCats = await prisma.presetCategory.findMany({ where: { active: true, key: { in: subs } } })
  const catMeta: Record<string, { vi: string; zh: string; en: string }> = Object.fromEntries(
    customCats.map((c) => [c.key, { vi: c.nameVi, zh: c.nameZh, en: c.nameEn }]),
  )
  const items = presets.flatMap((p) => {
    const meta = FOOD_SUBCATEGORIES[p.subcategory] ?? catMeta[p.subcategory]
    const categoryI18n = meta ? { vi: meta.vi, zh: meta.zh, en: meta.en } : undefined
    return ((p.items as PresetDishItem[]) ?? []).map((it) => ({ ...it, categoryI18n }))
  })
  const valid = items.filter((i) => i.nativeName?.trim() && Number.isFinite(Number(i.defaultPrice)) && Number(i.defaultPrice) > 0)
  console.log(`合并 ${items.length} 道，有效 ${valid.length} 道`)

  // 清空重建（复刻 publishShopDraft：覆盖即删除旧 Product）
  const existing = await prisma.product.count({ where: { shopId } })
  await prisma.$transaction(async (tx) => {
    if (existing > 0) {
      const cur = await tx.product.findMany({ where: { shopId }, orderBy: { sortOrder: 'asc' } })
      const snapshot = cur.map((p) => ({
        name: p.name, price: Number(p.price), unit: p.unit, category: p.category,
        sortOrder: p.sortOrder, active: p.active, config: p.config,
      }))
      await tx.product.deleteMany({ where: { shopId } })
      const draft = await tx.shopDraft.findUnique({ where: { shopId } })
      if (draft) await tx.shopDraft.update({ where: { id: draft.id }, data: { snapshot: snapshot as unknown as never } })
    }
    for (let idx = 0; idx < valid.length; idx++) {
      const it = valid[idx]
      await tx.product.create({
        data: {
          shopId,
          name: it.nativeName.trim(),
          price: Number(it.defaultPrice),
          unit: it.unit ?? null,
          category: it.categoryI18n?.vi ?? null,
          sortOrder: idx,
          config: buildProductConfig(it) as unknown as never,
        },
      })
    }
  })
  console.log(`✅ demo 店清空重建完成：${valid.length} 个商品（原 ${existing} 个）`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
