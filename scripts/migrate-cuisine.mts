// 第 20 批数据迁移：现有 11 个子分类归位到 cuisine 维度
//   pho/banh-mi/seafood/dessert/fried-snacks → cuisine='vn'（纯越南菜，保留 items）
//   coffee/milk-tea                          → cuisine='drink'（酒水饮品，保留 items）
//   hotpot/bbq/stir-fry/grilled-fish         → active=false（旧中越混合类，新类拆分子分类后存档不删）
// 用法：pnpm tsx scripts/migrate-cuisine.mts
import 'dotenv/config'
import { PrismaClient, Prisma } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// 目标：子分类 → cuisine
const VN_PURE = ['pho', 'banh-mi', 'seafood', 'dessert', 'fried-snacks'] // 纯越南菜
const DRINK = ['coffee', 'milk-tea'] // 酒水饮品
const MIX_ARCHIVE = ['hotpot', 'bbq', 'stir-fry', 'grilled-fish'] // 旧中越混合，新拆分后存档停用

async function main() {
  const all = await prisma.foodPreset.findMany({ where: { country: 'VN' }, orderBy: { subcategory: 'asc' } })
  console.log(`现有 FoodPreset ${all.length} 行`)
  for (const row of all) {
    let cuisine = 'vn'
    let active = row.active
    if (DRINK.includes(row.subcategory)) cuisine = 'drink'
    else if (MIX_ARCHIVE.includes(row.subcategory)) {
      cuisine = 'vn'
      active = false // 存档：旧混合类停用，让位给新拆分分类
    }
    await prisma.foodPreset.update({
      where: { id: row.id },
      data: { cuisine, active },
    })
    console.log(`  ${row.subcategory.padEnd(14)} → cuisine=${cuisine}  active=${active}  items=${(row.items as unknown[])?.length ?? 0}`)
  }
  await prisma.$disconnect()
  console.log('迁移完成')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
