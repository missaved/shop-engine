// demo 店多语言增量补全（第 20 批多语言整改 · 第二步，在 refill-zh 完成后跑）
// 思路：refill 把 FoodPreset.items 补成三语后，把 demo 店已有商品按 nativeName 匹配，
// 增量补缺失的中文描述 / 中文加料 / 单位 / 分类，绝不覆盖老板手动设置过的值。
// 用法：pnpm tsx scripts/update-demo-products.mts [phone]   # 默认 0901234567
// 幂等：重复跑只补仍缺失的，已补的不动。
import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { FOOD_SUBCATEGORIES } from '../lib/llm/prompts'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const phone = process.argv[2] ?? '0901234567'

type PresetDish = Record<string, unknown> & {
  nativeName?: string
  description_zh?: string
  extras?: string[]
  extras_zh?: string[]
  unit?: string
  unit_zh?: string
  optionGroups?: { name: string; nameZh?: string; options: { name: string; nameZh?: string }[] }[]
}

// 1) 建 nativeName → { subcategory, item } 索引（只 active 类，按各自 cuisine 查）
const idx = new Map<string, { sub: string; item: PresetDish }>()
const subs = [...Object.keys(FOOD_SUBCATEGORIES)]
const customCats = await prisma.presetCategory.findMany({ where: { active: true } })
const customByKey = new Map(customCats.map((c) => [c.key, c]))
for (const c of customCats) subs.push(c.key)
for (const sub of subs) {
  const staticMeta = FOOD_SUBCATEGORIES[sub]
  const custom = customByKey.get(sub)
  const cuisine = (staticMeta?.cuisine ?? custom?.cuisine ?? 'vn') as 'vn' | 'cn' | 'drink'
  const preset = await prisma.foodPreset.findUnique({
    where: { country_cuisine_subcategory: { country: 'VN', cuisine, subcategory: sub } },
  })
  if (!preset || !preset.active) continue
  for (const it of (preset.items as PresetDish[] | null) ?? []) {
    if (it.nativeName && !idx.has(it.nativeName)) idx.set(it.nativeName, { sub, item: it })
  }
}
console.log(`预设索引：${idx.size} 个 nativeName（${subs.length} 类）`)

// 2) 子分类三语名（自动归类 categoryI18n 来源）
const catCache = new Map<string, { vi: string; zh: string; en: string } | null>()
async function catI18n(sub: string) {
  if (catCache.has(sub)) return catCache.get(sub) ?? null
  const staticMeta = FOOD_SUBCATEGORIES[sub]
  const c = staticMeta ? null : customByKey.get(sub)
  const out = staticMeta
    ? { vi: staticMeta.vi, zh: staticMeta.zh, en: staticMeta.en }
    : c
      ? { vi: c.nameVi, zh: c.nameZh, en: c.nameEn }
      : null
  catCache.set(sub, out)
  return out
}

async function main() {
  const user = await prisma.user.findUnique({ where: { phone } })
  if (!user?.shopId) throw new Error(`phone=${phone} 无 shopId`)
  const shopId = user.shopId
  const products = await prisma.product.findMany({ where: { shopId, active: true } })
  console.log(`demo 店 ${shopId} active 商品 ${products.length} 个`)

  let matched = 0
  let zhFixed = 0
  let extrasFixed = 0
  let unitFixed = 0
  let catFixed = 0

  for (const p of products) {
    const cfg = (p.config as Record<string, unknown> | null) ?? {}
    const nameI18n = (cfg.nameI18n as Record<string, string> | undefined) ?? {}
    const descI18n = (cfg.descI18n as Record<string, string> | undefined) ?? {}
    const extras = (cfg.extras as { name: string; nameZh?: string }[] | undefined) ?? []
    const optionGroups = (cfg.optionGroups as { name: string; nameZh?: string; options: { name: string; nameZh?: string }[] }[] | undefined) ?? []

    const hit = idx.get(p.name) ?? idx.get(nameI18n.vi ?? '')
    if (!hit) continue // 老板自定义商品，不匹配，保留原样
    matched++

    const { sub, item } = hit
    const dirty: Record<string, unknown> = {}

    // 3a) 中文描述：仅当 zh==vi（导入痕迹）才替换为 refill 的中文
    if (item.description_zh && descI18n.zh && descI18n.zh === descI18n.vi && descI18n.zh !== item.description_zh) {
      descI18n.zh = item.description_zh
      zhFixed++
    }

    // 3b) 中文加料：按 name 精确匹配补 nameZh（防止老板改过顺序导致错位）
    const zhByViName = new Map<string, string>()
    for (let i = 0; i < (item.extras ?? []).length; i++) zhByViName.set(item.extras![i], item.extras_zh?.[i] ?? '')
    let exChanged = false
    for (const ex of extras) {
      if (!ex.nameZh && zhByViName.get(ex.name)) {
        ex.nameZh = zhByViName.get(ex.name)
        exChanged = true
      }
    }
    if (exChanged) extrasFixed++

    // 3c) 单位：始终补 unitI18n（vi 用现 DB 列值保留老板手动，zh 用 refill 中文）
    const unitI18n = { vi: p.unit ?? item.unit ?? '', zh: item.unit_zh ?? '' }
    if (item.unit_zh && !cfg.unitI18n) {
      cfg.unitI18n = unitI18n
      unitFixed++
    }
    if (!p.unit && item.unit) dirty.unit = item.unit // DB 列为空才填（不覆盖老板手动）

    // 3d) 分类：补 categoryI18n（vi 用现 DB 列保留老板手动，zh/en 用子分类三语名）
    const ci = await catI18n(sub)
    if (ci && !cfg.categoryI18n) {
      cfg.categoryI18n = { vi: p.category ?? ci.vi, zh: ci.zh, en: ci.en }
      catFixed++
      if (!p.category) dirty.category = ci.vi // DB 列为空才填
    }

    // 3e) 酒水规格 optionGroups：补 nameZh（demo 店多为空，直接并入 refill 双语模板）
    if (item.optionGroups?.length && !optionGroups.length) {
      cfg.optionGroups = item.optionGroups
    }

    dirty.config = cfg
    await prisma.product.update({ where: { id: p.id }, data: dirty })
  }

  console.log(`匹配 ${matched}/${products.length}；中文描述替换 ${zhFixed}；加料补名 ${extrasFixed}；单位补 ${unitFixed}；分类补 ${catFixed}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
