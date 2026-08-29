// 预设图归档整理（第 19 批 A4 补充）：把早期平铺命名（public/uploads/presets/preset-*.jpg）
// 迁移成语义路径 public/uploads/presets/{country}/{subcategory}/{slug}-*.jpg 并回写 FoodPreset.items[].imageUrl。
// 幂等：已语义化 / 指向占位图的跳过。用法：pnpm tsx scripts/archive-presets.mts
// 用户约束（2026-08-28）：图片及时归档，文件名带国家/子分类/菜名，可慢不可错。
import 'dotenv/config'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PrismaClient, Prisma } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const PRESETS_DIR = path.join(process.cwd(), 'public', 'uploads', 'presets')

function slugify(s: string): string {
  const ascii = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dish'
}

// 平铺文件名 preset-{ts}-{rand}.jpg → 提取后缀 {ts}-{rand}.jpg
const FLAT = /^preset-([0-9]+-[a-z0-9]+)\.jpg$/

type DishItem = { nativeName?: string; imageUrl?: string } & Record<string, unknown>

async function main() {
  const rows = await prisma.foodPreset.findMany({ where: { country: 'VN' } })
  let moved = 0
  let skipped = 0
  for (const row of rows) {
    const sub = row.subcategory
    const items = (row.items as DishItem[]) ?? []
    let changed = false
    for (const item of items) {
      const url = item.imageUrl
      if (!url || !url.startsWith('/uploads/presets/')) continue
      const file = path.basename(url)
      const m = file.match(FLAT)
      if (!m) { skipped++; continue } // 已语义化或占位图
      const src = path.join(PRESETS_DIR, file)
      const slug = slugify(item.nativeName ?? 'dish')
      const targetDir = path.join(PRESETS_DIR, 'vn', sub)
      const targetFile = `${slug}-${m[1]}.jpg`
      await fs.mkdir(targetDir, { recursive: true })
      await fs.rename(src, path.join(targetDir, targetFile))
      item.imageUrl = `/uploads/presets/vn/${sub}/${targetFile}`
      moved++
      changed = true
      console.log(`  移动 ${file} → vn/${sub}/${targetFile}`)
    }
    if (changed) {
      await prisma.foodPreset.update({ where: { id: row.id }, data: { items: row.items as Prisma.InputJsonValue } })
      console.log(`[${sub}] imageUrl 已回写`)
    }
  }
  // 孤儿平铺文件报告（无 DB 引用 = 未知来源，用户关注点）
  let orphans: string[] = []
  try {
    const files = await fs.readdir(PRESETS_DIR)
    orphans = files.filter((f) => FLAT.test(f))
  } catch {}
  console.log(`\n归档完成：移动 ${moved} 张，跳过 ${skipped} 张`)
  if (orphans.length) {
    console.log(`⚠️  孤儿平铺文件 ${orphans.length} 张（无 DB 引用，可能来自中断批次）:`)
    for (const o of orphans) console.log(`  - ${o}`)
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
