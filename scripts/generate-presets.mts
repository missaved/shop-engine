// 预生成 FoodPreset 预设库（第 20 批目录 v4）：LLM 链批量生成菜品 → 逐道出图 → upsert FoodPreset
// 第 20 批改动：
//   - 按 meta.cuisine（vn/cn/drink）走对应 prompt（中越拆分 + 酒水真实品牌中性图）
//   - 每类目标道数取 meta.count（默认 40；锅底/矿泉水等天然小项 15-25）
//   - 已有 items 时 top-up：只生成差额，existingNames 传入防重
//   - 酒水类由脚本确定性挂载 optionGroups 规格模板（不经 LLM，避免编造规格）
//   - 断网/偶发失败重试一次；QUOTA（minimax 5h 复位）默认退出码 3，--auto-wait 时睡眠 5h 后自动续跑
// 用法：
//   pnpm tsx scripts/generate-presets.mts                    # 全部 35 类（按 meta.count）
//   pnpm tsx scripts/generate-presets.mts --cuisine=cn       # 只跑中国菜
//   pnpm tsx scripts/generate-presets.mts beer soft-drinks   # 只跑指定类
//   pnpm tsx scripts/generate-presets.mts --count=40 --force # 强制全部重生成
//   pnpm tsx scripts/generate-presets.mts --auto-wait        # QUOTA 后睡 5h 自动续跑（无人值守）
// 幂等：按 (country, cuisine, subcategory) upsert，重跑覆盖 items，不产生脏行。
import 'dotenv/config'
import { PrismaClient, Prisma } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { generateStructuredJSON } from '../lib/llm/generate'
import { generateImage, PLACEHOLDER_URL } from '../lib/llm/image'
import {
  DishBatchSchema,
  type DishBatch,
  type DishItem,
  type SubcategoryMeta,
  type Cuisine,
  FOOD_SUBCATEGORIES,
  buildDishSystemPrompt,
  buildDishUserPrompt,
  buildImagePrompt,
} from '../lib/llm/prompts'

const COUNTRY = 'VN'
const QUOTA_WAIT_MS = 5 * 60 * 60 * 1000 + 5 * 60 * 1000 // minimax 5h 复位 + 5min 余量

// 越南语菜名 → ascii slug（去音标），用于图片归档文件名（用户：文件名带国家/菜系/菜名，可慢不可错）
function slugify(s: string): string {
  const ascii = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dish'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const args = process.argv.slice(2)
let subs = args.filter((a) => !a.startsWith('--'))
const cuisineArg = args.find((a) => a.startsWith('--cuisine='))
const countArg = args.find((a) => a.startsWith('--count='))
const force = args.includes('--force')
const autoWait = args.includes('--auto-wait')
const cuisineFilter = cuisineArg ? cuisineArg.split('=')[1] : undefined

let adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
let prisma = new PrismaClient({ adapter })

type ItemRow = (DishItem & { currency?: string; imageUrl?: string })[]

// 处理单个子分类；返回 'ok' | 'failed'（文本失败） | 'QUOTA'（图片超额，需等待复位）
// meta 由 main 解析（静态 FOOD_SUBCATEGORIES ∪ DB PresetCategory，第 20 批 Admin「新增品类」）
async function processSub(sub: string, meta: SubcategoryMeta): Promise<'ok' | 'failed' | 'QUOTA'> {
  if (!meta) {
    console.warn(`⚠️  未知子分类: ${sub}（可用: 静态 35 类 + PresetCategory 自定义类）`)
    return 'ok'
  }
  const target = countArg ? Number(countArg.split('=')[1]) : meta.count

  // 已有数据（top-up）：force 时丢弃全部
  const existing = await prisma.foodPreset.findUnique({
    where: { country_cuisine_subcategory: { country: COUNTRY, cuisine: meta.cuisine, subcategory: sub } },
  })
  const existingItems = (existing?.items as ItemRow) ?? []
  const keepCount = force ? 0 : Math.min(existingItems.length, target)
  const needCount = target - keepCount
  if (needCount <= 0) {
    console.log(`[${sub}] 已有 ${existingItems.length} 道 ≥ ${target}，跳过`)
    return 'ok'
  }

  console.log(`\n=== [${sub}] ${meta.vi}（${meta.zh} / ${meta.en}）cuisine=${meta.cuisine} 新增 ${needCount} 道（保留 ${keepCount}）===`)
  const t0 = Date.now()

  // 1. LLM 链分批生成（ds→minimax，每批 ≤20 道）：根治 40 道长 JSON 截断/超时（第 20 批终核抓到）
  //    逐批调用 + existingNames 逐批去重累积；整批失败重试；timeoutMs 180s（minimax 长输出需更久）
  const existingNames = existingItems.map((i) => i.nativeName)
  const dishes: DishItem[] = []
  let modelUsed: string | null = null
  const BATCH = 20
  let tries = 0
  while (dishes.length < needCount && tries < 12) {
    const want = Math.min(BATCH, needCount - dishes.length)
    const names = [...existingNames, ...dishes.map((d) => d.nativeName)]
    const gen = await generateStructuredJSON({
      system: buildDishSystemPrompt(meta.cuisine),
      user: buildDishUserPrompt(meta, want, names),
      schema: DishBatchSchema,
      timeoutMs: 180_000,
    })
    tries++
    if (!gen.ok) {
      console.error(`  ⚠️ [${sub}] 文本生成第 ${tries} 次失败：${gen.error.slice(0, 160)}`)
      continue
    }
    const got = (gen.data as DishBatch).dishes
    const fresh = got.filter((d) => !names.includes(d.nativeName))
    dishes.push(...fresh)
    modelUsed = gen.modelUsed
    console.log(`  ✅ 批次文本生成 ${got.length} 道（model=${gen.modelUsed}，新 ${fresh.length}）累计 ${dishes.length}/${needCount}`)
  }
  const needMin = Math.max(1, needCount - 2) // 允许差 ≤2 道（LLM 偶发不足/重复，不值得整类作废，第 20 批补跑实证）
  if (dishes.length < needMin) {
    console.error(`  ❌ ${sub} 文本生成未达目标（${dishes.length}/${needCount}，需≥${needMin}），跳过`)
    return 'failed'
  }
  if (dishes.length < needCount) {
    console.log(`  ⚠️ ${sub} 文本生成 ${dishes.length}/${needCount}（差 ${needCount - dishes.length} 道），接受写库`)
  }
  console.log(`  ✅ ${sub} 文本生成完成 ${dishes.length} 道（耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s）`)

  // 2. 逐道出图（minimax image-01，串行限流；按 country/subcat/slug 归档）
  //    QUOTA（余额/限流持续，minimax 5h 复位）→ 立即停，返回 'QUOTA' 由外层等复位续跑
  //    断网/偶发失败 → 重试 1 次后仍失败 → 占位图兜底（不中断批次，结束后可 refill）
  const newItems: Prisma.InputJsonValue[] = []
  let imgFail = 0
  for (let i = 0; i < dishes.length; i++) {
    const d = dishes[i]
    const prompt = buildImagePrompt(d.nativeName, d.name_en, d.imagePrompt)
    const metaForImg = { country: COUNTRY.toLowerCase(), subcategory: sub, slug: slugify(d.nativeName) }
    let img = await generateImage(prompt, metaForImg)
    if (!img.ok && !img.error.startsWith('QUOTA:')) {
      console.log(`  ${d.nativeName} 首次失败（${img.error.slice(0, 80)}），5s 后重试...`)
      await sleep(5000)
      img = await generateImage(prompt, metaForImg)
    }
    if (img.ok) {
      console.log(`  [${i + 1}/${dishes.length}] ${d.nativeName} 出图 ${img.url}`)
    } else if (img.error.startsWith('QUOTA:')) {
      console.error(`  ⏸ ${d.nativeName} 出图超额：${img.error}`)
      return 'QUOTA'
    } else {
      imgFail++
      console.log(`  [${i + 1}/${dishes.length}] ${d.nativeName} 出图失败→占位图：${img.error.slice(0, 120)}`)
    }
    newItems.push({
      ...d,
      currency: 'VND',
      optionGroups: meta.optionGroups ?? d.optionGroups ?? [],
      imageUrl: img.ok ? img.url : PLACEHOLDER_URL,
    })
  }

  // 3. 合并已有（补 optionGroups 规格）→ upsert FoodPreset（幂等，按 country+cuisine+subcategory）
  const merged: Prisma.InputJsonValue[] = [
    ...existingItems
      .slice(0, keepCount)
      .map((it) => ({ ...it, optionGroups: meta.optionGroups ?? it.optionGroups ?? [], imageUrl: it.imageUrl ?? PLACEHOLDER_URL })),
    ...newItems,
  ]
  const preset = await prisma.foodPreset.upsert({
    where: { country_cuisine_subcategory: { country: COUNTRY, cuisine: meta.cuisine, subcategory: sub } },
    update: { items: merged, promptVersion: 'v2', modelUsed: modelUsed, priceSource: 'llm-ai-vn', active: true },
    create: {
      country: COUNTRY,
      cuisine: meta.cuisine,
      subcategory: sub,
      items: merged,
      promptVersion: 'v2',
      modelUsed: modelUsed,
      priceSource: 'llm-ai-vn',
      active: true,
    },
  })
  console.log(`  ✅ FoodPreset 写入 id=${preset.id}，${merged.length} 道（新增出图失败 ${imgFail} 道走占位图，总耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s）`)
  return 'ok'
}

async function main() {
  // Admin「新增品类」：DB 注册的 PresetCategory（active）合并进 meta 表（静态 35 类 + 自定义类并存）
  const customCats = await prisma.presetCategory.findMany({ where: { active: true } })
  const metaMap: Record<string, SubcategoryMeta> = { ...FOOD_SUBCATEGORIES }
  for (const c of customCats) {
    const cuisine: Cuisine = c.cuisine === 'cn' || c.cuisine === 'drink' ? c.cuisine : 'vn'
    metaMap[c.key] = { vi: c.nameVi, en: c.nameEn, zh: c.nameZh, cuisine, count: c.count, examples: c.examples }
  }
  // 未指定子分类 → 全量（含自定义类；--cuisine= 过滤沿用）
  if (!subs.length) {
    subs = Object.keys(metaMap).filter((sub) => !cuisineFilter || metaMap[sub].cuisine === cuisineFilter)
  }
  console.log(`FoodPreset 预生成 batch20：${subs.length} 个子分类（静态 35 + 自定义 ${customCats.length}），force=${force}，autoWait=${autoWait}`)
  console.log('子分类：' + subs.map((s) => `${s}(${metaMap[s]?.count ?? '?'})`).join(', '))
  const pending = [...subs]
  const failed: string[] = []
  while (pending.length) {
    const sub = pending.shift()!
    const res = await processSub(sub, metaMap[sub])
    if (res === 'ok') continue
    if (res === 'QUOTA') {
      if (!autoWait) {
        console.error(`\n=== 批次停止：minimax 超额（5h 复位），待复位后重跑 [${sub}] 及以上 ===`)
        await prisma.$disconnect()
        process.exit(3)
      }
      console.error(`[${new Date().toISOString()}] minimax 超额，等待 ${QUOTA_WAIT_MS / 3_600_000}h 复位后重跑 [${sub}] ...`)
      await prisma.$disconnect()
      await sleep(QUOTA_WAIT_MS)
      adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
      prisma = new PrismaClient({ adapter })
      pending.unshift(sub)
      console.log(`[${new Date().toISOString()}] 复位完成，继续...`)
      continue
    }
    // failed（文本失败）：记录并继续，最后汇总提示可重跑
    failed.push(sub)
    console.error(`  ❌ [${sub}] 文本生成失败，已跳过（可在复位后重跑）`)
  }
  await prisma.$disconnect()
  console.log('\n预生成完成' + (failed.length ? `；文本失败需重跑：${failed.join(', ')}` : ''))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
