// 存量多语言补全（第 20 批多语言整改）：给 FoodPreset.items 补 description_zh / unit / unit_zh / extras_zh
// 只补文本不重新出图（图片已生成，imageUrl 原样保留）；酒水类顺便把 optionGroups 替换为双语模板
// 用法：
//   pnpm tsx scripts/refill-zh.mts                    # 全部 35 类（含自定义）
//   pnpm tsx scripts/refill-zh.mts pho com            # 指定类
//   pnpm tsx scripts/refill-zh.mts --auto-wait        # minimax 超额后睡 5h 自动续跑
// 幂等：按 nativeName 匹配回填，重跑覆盖 zh 字段，不影响已有 imageUrl / name / price
import 'dotenv/config'
import { z } from 'zod'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { generateStructuredJSON } from '../lib/llm/generate'
import { FOOD_SUBCATEGORIES, type SubcategoryMeta, type Cuisine } from '../lib/llm/prompts'

const COUNTRY = 'VN'
const QUOTA_WAIT_MS = 5 * 60 * 60 * 1000 + 5 * 60 * 1000 // minimax 5h 复位 + 5min 余量
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 补全单批的输出 schema
const ZhItemSchema = z.object({
  nativeName: z.string().min(1),
  description_zh: z.string().min(1), // 中文描述
  unit: z.string(), // 越南语计量单位（原样给，缺则按份卖 phần）
  unit_zh: z.string(), // 中文计量单位
  extras_zh: z.array(z.string()).default([]), // 中文加料（与 extras 一一对应）
})
const ZhBatchSchema = z.object({ dishes: z.array(ZhItemSchema).min(1).max(60) })
type ZhBatch = z.infer<typeof ZhBatchSchema>

const SYSTEM = `你是越南餐厅菜单的中文本地化专家。把越南语菜品的描述、计量单位、加料翻译/改写为地道中文。
要求：
- description_zh：忠实翻译越南语描述成中文，1-2 句，读起来像真实菜单文案，不要逐字生硬。
- unit / unit_zh：计量单位对（如 tô→碗、phần→份、cái→个、lon→罐、ly→杯、kg→公斤）；无特殊单位按份卖写 phần/份。
- extras_zh：与越南语 extras 一一对应、顺序相同的中文翻译；extras 为空则返回 []。
- 每道菜键名严格：nativeName、description_zh、unit、unit_zh、extras_zh。
- 只输出一个 JSON 对象：{"dishes": [ {...}, ... ]}，不要 markdown 代码块，不要任何解释文字。`

function buildUser(lines: string[]): string {
  return `请为以下菜品补全中文字段。每行输入格式：nativeName | 越南语描述 | 越南语加料（顿号分隔，无=空）
输出每道菜：{"nativeName": 原样, "description_zh", "unit", "unit_zh", "extras_zh"}
菜品：
${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`
}

let adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
let prisma = new PrismaClient({ adapter })

const args = process.argv.slice(2)
let subs = args.filter((a) => !a.startsWith('--'))
const autoWait = args.includes('--auto-wait')
const BATCH = 20

// 单子分类补全；返回 'ok' | 'QUOTA' | 'skip'
async function refillSub(sub: string, meta: SubcategoryMeta): Promise<'ok' | 'QUOTA' | 'skip'> {
  const preset = await prisma.foodPreset.findUnique({
    where: { country_cuisine_subcategory: { country: COUNTRY, cuisine: meta.cuisine, subcategory: sub } },
  })
  const items = ((preset?.items as Record<string, unknown>[] | null) ?? []).map((it) => ({ ...it }))
  if (!items.length) return 'skip'
  // 淘汰类（active=false，如 bbq/grilled-fish/hotpot/stir-fry 已被拆分版替代）不补，省 LLM 额度
  if (preset && !preset.active) {
    console.log(`[${sub}] inactive 淘汰类，跳过`)
    return 'skip'
  }
  // 判断是否已补过「真中文」（LLM 结果特征：description_zh != description_local）。
  // 不能用「description_zh 非空」判断——上一版 bug 把全部兜底成越南语，会被误判为已完成。
  const refilled = items.every((it) => !!it.description_zh && it.description_zh !== it.description_local)
  if (refilled) {
    console.log(`[${sub}] 全部 ${items.length} 道已是真中文，跳过`)
    return 'ok'
  }
  console.log(`\n=== [${sub}] ${meta.vi}（${meta.zh}）补全 ${items.length} 道中文文本（保留图片）===`)
  const t0 = Date.now()

  // 分批补全 zh 字段
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH)
    const inputLines = batch.map(
      (it) =>
        `${it.nativeName} | ${it.description_local ?? ''} | ${((it.extras as string[]) ?? []).join('、') || '空'}`,
    )
    let done = false
    for (let tries = 0; tries < 8 && !done; tries++) {
      const gen = await generateStructuredJSON({
        system: SYSTEM,
        user: buildUser(inputLines),
        schema: ZhBatchSchema,
        timeoutMs: 180_000,
      })
      if (!gen.ok) {
        if (/QUOTA|限流|rate/i.test(gen.error)) return 'QUOTA'
        console.error(`  ⚠️ [${sub}] 批 ${i / BATCH + 1} 第 ${tries + 1} 次失败：${gen.error.slice(0, 140)}`)
        continue
      }
      const got = gen.data as ZhBatch
      for (const z of got.dishes) {
        const idx = batch.findIndex((it) => it.nativeName === z.nativeName)
        if (idx >= 0) {
          // 必须改原对象（Object.assign）而不是替换 batch 元素：batch 是 items.slice 副本，
          // 替换元素不会写回 items，导致 LLM 结果丢失（2026-08-29 实测踩坑）
          Object.assign(batch[idx], {
            description_zh: z.description_zh,
            unit: z.unit || undefined,
            unit_zh: z.unit_zh || undefined,
            extras_zh: z.extras_zh,
          })
        }
      }
      const filled = batch.filter((it) => it.description_zh).length
      console.log(`  ✅ 批 ${i / BATCH + 1} 回填 ${filled}/${batch.length} 道（model=${gen.modelUsed}）`)
      done = true
    }
    if (!done) console.error(`  ⚠️ [${sub}] 批 ${i / BATCH + 1} 重试耗尽，部分未补全`)
  }

  // 酒水类：把 optionGroups 替换为双语模板（多语言整改：越南语主名 + 中文 nameZh）
  if (meta.optionGroups) {
    for (const it of items) it.optionGroups = meta.optionGroups
  }
  // 补齐无 description_zh 的兜底（LLM 漏的）：回退用 description_local 顶（至少不为空串）
  for (const it of items) {
    if (!it.description_zh) it.description_zh = it.description_local ?? ''
    if (!it.extras_zh) it.extras_zh = []
  }

  await prisma.foodPreset.update({
    where: { country_cuisine_subcategory: { country: COUNTRY, cuisine: meta.cuisine, subcategory: sub } },
    data: { items: items as never },
  })
  console.log(`  ✅ FoodPreset 更新 ${sub}，${items.length} 道（耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s）`)
  return 'ok'
}

async function main() {
  const customCats = await prisma.presetCategory.findMany({ where: { active: true } })
  const metaMap: Record<string, SubcategoryMeta> = { ...FOOD_SUBCATEGORIES }
  for (const c of customCats) {
    const cuisine: Cuisine = c.cuisine === 'cn' || c.cuisine === 'drink' ? c.cuisine : 'vn'
    metaMap[c.key] = { vi: c.nameVi, en: c.nameEn, zh: c.nameZh, cuisine, count: c.count, examples: c.examples }
  }
  if (!subs.length) subs = Object.keys(metaMap)
  console.log(`多语言补全 refill-zh：${subs.length} 个子分类，autoWait=${autoWait}`)
  console.log('子分类：' + subs.map((s) => `${s}(${metaMap[s]?.count ?? '?'})`).join(', '))

  const pending = [...subs]
  let quotaHit = false
  while (pending.length) {
    const sub = pending.shift()!
    const res = await refillSub(sub, metaMap[sub])
    if (res === 'QUOTA') {
      quotaHit = true
      if (!autoWait) {
        console.error(`\n=== 停止：minimax 超额，重跑补全时加 --auto-wait ===`)
        break
      }
      console.error(`[${new Date().toISOString()}] minimax 超额，等待 ${QUOTA_WAIT_MS / 3_600_000}h 复位后继续 [${sub}] ...`)
      await prisma.$disconnect()
      await sleep(QUOTA_WAIT_MS)
      adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
      prisma = new PrismaClient({ adapter })
      pending.unshift(sub)
      console.error(`[${new Date().toISOString()}] 复位完成，继续...`)
    }
  }
  await prisma.$disconnect()
  console.log('\n多语言补全完成' + (quotaHit ? '（含 QUOTA 中断，需 --auto-wait 续跑）' : ''))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
