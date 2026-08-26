// 种子数据：1 家演示店（food 垂直）+ 商品
// 运行：pnpm prisma db seed（幂等：店铺按 slug 去重，商品仅在店无商品时创建）
import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
})
const prisma = new PrismaClient({ adapter })

async function main() {
  const shop = await prisma.shop.upsert({
    where: { slug: 'demo-pho' },
    update: {},
    create: {
      slug: 'demo-pho',
      name: 'Phở Demo 88',
      vertical: 'FOOD',
      phone: '0901234567',
      address: '12 Nguyễn Huệ, Q1, TP.HCM',
      config: {
        openHours: '07:00-22:00',
        minOrder: 50000, // 起送价
      },
    },
  })

  const existing = await prisma.product.count({ where: { shopId: shop.id } })
  if (existing === 0) {
    const items = [
      { name: 'Phở bò tái', price: 60000, unit: 'tô' },
      { name: 'Phở gà', price: 55000, unit: 'tô' },
      { name: 'Bánh mì thịt', price: 35000, unit: 'ổ' },
      { name: 'Trà đá', price: 5000, unit: 'ly' },
    ]
    for (const it of items) {
      await prisma.product.create({
        data: { shopId: shop.id, ...it, category: 'Món chính' },
      })
    }
    console.log(`已创建演示店「${shop.name}」和 ${items.length} 个商品`)
  } else {
    console.log(`演示店「${shop.name}」已存在，商品 ${existing} 个，跳过创建`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
