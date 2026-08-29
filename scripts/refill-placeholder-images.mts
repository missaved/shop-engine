// 占位图补全（第 19 批 A4 补充）：把 FoodPreset.items 里 imageUrl=placeholder 的菜重出图，回写语义路径。
// 用法：pnpm tsx scripts/refill-placeholder-images.mts [sub...]（无参数=全部子分类）
// QUOTA（余额/限流持续）→ 整批停止等复位，不写占位图。
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

async function main() {
  const args = process.argv.slice(2)
  const subs = args.length
    ? args
    : (await prisma.foodPreset.findMany({ where: { country: 'VN' } })).map((r) => r.subcategory)
  for (const sub of subs) {
    const row = await prisma.foodPreset.findFirst({
      where: { country: 'VN', subcategory: sub },
    })
    if (!row) { console.warn(`无 ${sub} 预设`); continue }
    const items = (row.items as DishItem[]) ?? []
    let changed = false
    for (const it of items) {
      if (!it.imageUrl || !String(it.imageUrl).includes('placeholder')) continue
      const img = await generateImage(buildImagePrompt(it.nativeName ?? '', it.name_en ?? '', it.imagePrompt ?? ''), {
        country: 'vn', subcategory: sub, slug: slugify(it.nativeName ?? 'dish'),
      })
      if (img.ok) {
        it.imageUrl = img.url
        changed = true
        console.log(`  [${sub}] ${it.nativeName} 补图 ${img.url}`)
      } else if (img.error.startsWith('QUOTA:')) {
        console.error(`  ⏸ ${it.nativeName} 出图超额：${img.error}`)
        await prisma.$disconnect()
        console.error('\n=== 停止：minimax 超额，等待复位后重跑 ===')
        process.exit(3)
      } else {
        console.log(`  [${sub}] ${it.nativeName} 补图失败仍占位：${img.error}`)
      }
    }
    if (changed) {
      await prisma.foodPreset.update({ where: { id: row.id }, data: { items: row.items as Prisma.InputJsonValue } })
      console.log(`[${sub}] 占位图已补`)
    }
  }
  await prisma.$disconnect()
  console.log('占位图补全结束')
}

main().catch((e) => { console.error(e); process.exit(1) })
