// 敏感词失败图重试（2026-08-29 紧急插入 6）：5 张被 minimax input new_sensitive 拦截的占位图。
// 触发词定位：probe 确认是 "kaffir lime leaves"（kaffir 被 minimax 误判为种族歧视词）。
// 修复：imagePrompt 与 name_en 中 kaffir lime → lime，重试出图，成功回写语义路径。
// 用法：pnpm tsx scripts/retry-sensitive-images.mts
import 'dotenv/config'
import { PrismaClient, Prisma } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { generateImage } from '../lib/llm/image'
import { buildImagePrompt } from '../lib/llm/prompts'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

function slugify(s: string): string {
  const ascii = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dish'
}

type DishItem = { nativeName?: string; name_en?: string; imagePrompt?: string; imageUrl?: string } & Record<string, unknown>

// minimax 敏感词：kaffir（种族歧视词）→ lime；prompt/name_en 里的 kaffir lime leaves 全部替换
const scrub = (s: string): string => String(s).replace(/kaffir lime leaves/gi, 'lime leaves').replace(/kaffir lime/gi, 'lime')

// 无 imagePrompt 时的通用兜底描述（按菜系给中性摄影词）
const FALLBACK_PROMPT = 'A delicious home-style Vietnamese dish served on a rustic wooden table, fresh herbs, bright natural light, appetizing food photography'

const SUBS = ['grilled-fish-vn', 'seafood', 'nhau', 'hotpot-vn-base']

async function main() {
  let fixed = 0
  for (const sub of SUBS) {
    const row = await prisma.foodPreset.findFirst({ where: { country: 'VN', subcategory: sub } })
    if (!row) { console.warn(`无 ${sub} 预设`); continue }
    const items = (row.items as DishItem[]) ?? []
    let changed = false
    for (const it of items) {
      if (!it.imageUrl || !String(it.imageUrl).includes('placeholder')) continue
      const cleaned = scrub(it.imagePrompt ?? '') || FALLBACK_PROMPT
      if (cleaned !== (it.imagePrompt ?? '')) {
        it.imagePrompt = cleaned
        changed = true
      }
      const img = await generateImage(buildImagePrompt(it.nativeName ?? '', scrub(it.name_en ?? ''), cleaned), {
        country: 'vn', subcategory: sub, slug: slugify(it.nativeName ?? 'dish'),
      })
      if (img.ok) {
        it.imageUrl = img.url
        fixed++
        console.log(`  ✅ [${sub}] ${it.nativeName} 重试成功 ${img.url}`)
      } else if (img.error.startsWith('QUOTA:')) {
        console.error(`  ⏸ [${sub}] ${it.nativeName} 出图超额：${img.error}`)
        await prisma.$disconnect()
        console.error('\n=== 停止：minimax 超额，等待复位 ===')
        process.exit(3)
      } else {
        console.log(`  ❌ [${sub}] ${it.nativeName} 仍失败：${img.error}`)
      }
    }
    if (changed) {
      await prisma.foodPreset.update({ where: { id: row.id }, data: { items: row.items as Prisma.InputJsonValue } })
      console.log(`[${sub}] items 已回写`)
    }
  }
  await prisma.$disconnect()
  console.log(`重试结束：成功 ${fixed}/5`)
}

main().catch((e) => { console.error(e); process.exit(1) })
