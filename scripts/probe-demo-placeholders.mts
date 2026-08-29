// 一次性探针：验证 demo 店（demo-pho）占位图清零 —— 统计商品 image 含 placeholder 的数量
import 'dotenv/config'
import { prisma } from '../lib/prisma'

const shop = await prisma.shop.findUnique({ where: { slug: 'demo-pho' } })
if (!shop) throw new Error('demo-pho 不存在')

// 商品独立存 product 表（image 取自 config.image，占位图特征 = 含 placeholder）
const products = await prisma.product.findMany({
  where: { shopId: shop.id },
  select: { id: true, name: true, category: true, config: true },
})
const total = products.length
const imgOf = (p: (typeof products)[number]) => (p.config as { image?: string | null } | null)?.image ?? ''
const placeholders = products.filter((p) => imgOf(p).includes('placeholder'))
const noImg = products.filter((p) => !imgOf(p))
console.log(`demo-pho 商品总数: ${total}`)
console.log(`占位图（含 placeholder）: ${placeholders.length}`)
console.log(`无图（走 emoji 占位）: ${noImg.length}`)
if (placeholders.length > 0) {
  for (const p of placeholders.slice(0, 10)) console.log(`  占位: [${p.category}] ${p.name} → ${imgOf(p)}`)
}
await prisma.$disconnect()
