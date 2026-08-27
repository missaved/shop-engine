// 种子数据：1 家演示店（food 垂直）+ 商品 + 老板账号 + 示例订单
// 运行：pnpm prisma db seed（幂等：按 slug / phone / orderNo 去重）
import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'bcryptjs'

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
        minOrderAmount: 50000, // 起送价
      },
    },
  })

  // 商品（含三语名/描述 + emoji 图标；image 留空，老板后续在后台填图片 URL）
  const items = [
    {
      name: 'Phở bò tái',
      price: 60000,
      unit: 'tô',
      emoji: '🍜',
      nameI18n: { zh: '生牛肉粉', en: 'Rare Beef Pho', vi: 'Phở bò tái' },
      descI18n: {
        zh: '现烫生牛肉，汤清味鲜',
        en: 'Tender rare beef in clear broth',
        vi: 'Thịt bò tái mềm, nước dùng trong thanh ngọt',
      },
      extras: [
        { name: 'Thêm bò', price: 20000 },
        { name: 'Trứng', price: 10000 },
      ],
    },
    {
      name: 'Phở gà',
      price: 55000,
      unit: 'tô',
      emoji: '🍗',
      nameI18n: { zh: '鸡肉粉', en: 'Chicken Pho', vi: 'Phở gà' },
      descI18n: {
        zh: '走地鸡，汤底清甜',
        en: 'Free-range chicken, light broth',
        vi: 'Gà ta thơm, nước dùng ngọt thanh',
      },
    },
    {
      name: 'Bánh mì thịt',
      price: 35000,
      unit: 'ổ',
      emoji: '🥖',
      nameI18n: { zh: '越式法棍三明治', en: 'Banh Mi', vi: 'Bánh mì thịt' },
      descI18n: {
        zh: '外脆内软，配腌菜和酱',
        en: 'Crispy baguette with pickles and pâté',
        vi: 'Giòn bên ngoài, mềm bên trong, kèm đồ chua và pate',
      },
      extras: [
        { name: 'Thêm thịt', price: 15000 },
        { name: 'Thêm trứng', price: 8000 },
      ],
    },
    {
      name: 'Trà đá',
      price: 5000,
      unit: 'ly',
      emoji: '🧊',
      nameI18n: { zh: '冰茶', en: 'Iced Tea', vi: 'Trà đá' },
      descI18n: {
        zh: '解腻消暑',
        en: 'Refreshing and cooling',
        vi: 'Giải khát, thanh mát',
      },
    },
  ]

  for (const it of items) {
    const { emoji, nameI18n, descI18n, extras, ...rest } = it
    const config = { image: '', emoji, nameI18n, descI18n, extras: extras ?? [] }
    const found = await prisma.product.findFirst({
      where: { shopId: shop.id, name: it.name },
    })
    if (found) {
      // 已存在 → 只补三语/图片配置（幂等，不重复建）
      await prisma.product.update({ where: { id: found.id }, data: { config } })
    } else {
      await prisma.product.create({
        data: { shopId: shop.id, ...rest, category: 'Món chính', config },
      })
    }
  }
  console.log(`演示店「${shop.name}」商品 ${items.length} 个（三语名/描述/图标已就绪）`)

  // 老板账号（手机号登录）
  const owner = await prisma.user.upsert({
    where: { phone: '0901234567' },
    update: {},
    create: {
      shopId: shop.id,
      phone: '0901234567',
      passwordHash: await hash('demo1234', 10),
      name: 'Chủ quán',
      role: 'OWNER',
    },
  })
  console.log(`老板账号就绪：${owner.phone} / demo1234`)

  // 示例订单（用于老板侧验证）
  const orderCount = await prisma.order.count({ where: { shopId: shop.id } })
  if (orderCount === 0) {
    await prisma.order.create({
      data: {
        orderNo: 1,
        displayNo: 'CP-260826-001',
        shopId: shop.id,
        status: 'PENDING',
        items: [
          { name: 'Phở bò tái', qty: 2, price: 60000 },
          { name: 'Trà đá', qty: 2, price: 5000 },
        ],
        total: 130000,
        paidAmount: 0,
        customerName: 'Nguyễn Thị Lan',
        customerPhone: '0987654321',
      },
    })
    await prisma.order.create({
      data: {
        orderNo: 2,
        displayNo: 'CP-260826-002',
        shopId: shop.id,
        status: 'COMPLETED',
        items: [{ name: 'Bánh mì thịt', qty: 1, price: 35000 }],
        total: 35000,
        paidAmount: 35000,
        customerName: 'Trần Văn Hùng',
        customerPhone: '0912345678',
      },
    })
    console.log('已创建 2 个示例订单')
  } else {
    console.log(`已有 ${orderCount} 个订单，跳过创建`)
  }

  // 平台运营账号（ADMIN，不绑店；生产环境请改强密码）
  const admin = await prisma.user.upsert({
    where: { phone: '0900000000' },
    update: {},
    create: {
      shopId: null,
      phone: '0900000000',
      passwordHash: await hash('demo1234', 10),
      name: '平台运营',
      role: 'ADMIN',
    },
  })
  console.log(`平台运营账号就绪：${admin.phone} / demo1234（ADMIN）`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
