// 建 3 家测试店中的 B/C 两家：demo-cafe（咖啡外带店）+ demo-delivery（外卖专门店）
// 店 A demo-pho 已由 prisma/seed.ts 建立。本脚本幂等（按 slug/phone/name 去重）。
// 运行：cd /root/shop-saas/app && pnpm tsx scripts/seed-test-shops.ts
import 'dotenv/config'
import { PrismaClient, Prisma } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

type ShopDef = {
  slug: string
  name: string
  phone: string
  address: string
  config: Prisma.InputJsonValue
  products: {
    name: string
    price: number
    unit: string
    category: string
    config: Prisma.InputJsonValue
  }[]
}

const SHOPS: ShopDef[] = [
  {
    slug: 'demo-cafe',
    name: 'Cà phê 68',
    phone: '0901234568',
    address: '45 Lê Lợi, Q1, TP.HCM',
    config: { openHours: '06:00-21:00', minOrderAmount: 0 },
    products: [
      {
        name: 'Cà phê sữa đá',
        price: 25000,
        unit: 'ly',
        category: 'Cà phê',
        config: {
          extras: [{ name: 'Thêm sữa', price: 5000 }],
          optionGroups: [
            { name: 'Đá', required: true, options: [{ name: 'Đá', price: 0 }, { name: 'Nóng', price: 0 }] },
            { name: 'Cỡ', required: false, options: [{ name: 'M', price: 0 }, { name: 'L', price: 10000 }] },
          ],
          descI18n: {
            zh: '香浓炼乳冰咖啡，越南经典',
            en: 'Classic Vietnamese iced coffee with condensed milk',
            vi: 'Cà phê sữa đá thơm đậm, đậu đen rang',
          },
        },
      },
      {
        name: 'Trà sữa',
        price: 30000,
        unit: 'ly',
        category: 'Trà',
        config: {
          extras: [{ name: 'Trân châu', price: 5000 }],
          descI18n: {
            zh: '香浓奶茶，可选珍珠',
            en: 'Creamy milk tea, add pearls optional',
            vi: 'Trà sữa béo ngọt, thêm trân châu',
          },
        },
      },
      {
        name: 'Bánh ngọt',
        price: 20000,
        unit: 'cái',
        category: 'Bánh',
        config: {
          descI18n: {
            zh: '每日现烤小甜点',
            en: 'Daily baked pastry',
            vi: 'Bánh ngọt nướng mỗi ngày',
          },
        },
      },
    ],
  },
  {
    slug: 'demo-delivery',
    name: 'Giao 24',
    phone: '0901234569',
    address: '88 Trần Hưng Đạo, Q5, TP.HCM',
    config: { openHours: '10:00-20:00', minOrderAmount: 100000, deliveryFee: 15000, deliveryArea: '5km' },
    products: [
      {
        name: 'Cơm gà',
        price: 45000,
        unit: 'phần',
        category: 'Cơm',
        config: {
          extras: [{ name: 'Thêm gà', price: 15000 }],
          descI18n: {
            zh: '香嫩烤鸡配米饭，送例汤',
            en: 'Grilled chicken rice with side soup',
            vi: 'Cơm gà nướng thơm, kèm canh',
          },
        },
      },
      {
        name: 'Cơm bò',
        price: 55000,
        unit: 'phần',
        category: 'Cơm',
        config: {
          descI18n: {
            zh: '嫩牛肉片盖饭，微甜酱汁',
            en: 'Beef rice with savory sweet sauce',
            vi: 'Cơm bò mềm, sốt đậm đà',
          },
        },
      },
      {
        name: 'Nước ngọt',
        price: 10000,
        unit: 'lon',
        category: 'Nước',
        config: {
          descI18n: {
            zh: '冰镇碳酸饮料',
            en: 'Chilled soft drink',
            vi: 'Nước ngọt có ga ướp lạnh',
          },
        },
      },
    ],
  },
]

async function main() {
  for (const def of SHOPS) {
    const shop = await prisma.shop.upsert({
      where: { slug: def.slug },
      update: {},
      create: {
        slug: def.slug,
        name: def.name,
        vertical: 'FOOD',
        phone: def.phone,
        address: def.address,
        config: def.config,
      },
    })
    await prisma.user.upsert({
      where: { phone: def.phone },
      update: {},
      create: {
        shopId: shop.id,
        phone: def.phone,
        passwordHash: await hash('demo1234', 10),
        name: 'Chủ quán',
        role: 'OWNER',
      },
    })
    for (const p of def.products) {
      const found = await prisma.product.findFirst({ where: { shopId: shop.id, name: p.name } })
      if (found) {
        await prisma.product.update({ where: { id: found.id }, data: { price: p.price, config: p.config } })
      } else {
        await prisma.product.create({
          data: {
            shopId: shop.id,
            name: p.name,
            price: p.price,
            unit: p.unit,
            category: p.category,
            config: p.config,
          },
        })
      }
    }
    console.log(`✅ ${def.name}（${def.slug}）就绪：商品 ${def.products.length} 个，老板 ${def.phone}/demo1234`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
