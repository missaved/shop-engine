// 种子数据：1 家演示店（food 垂直）+ 商品 + 老板账号 + 示例订单
// 运行：pnpm prisma db seed（幂等：按 slug / phone / orderNo 去重）
import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'bcryptjs'
import { CITIES } from '../lib/city'

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
})
const prisma = new PrismaClient({ adapter })

async function main() {
  const shop = await prisma.shop.upsert({
    where: { slug: 'demo-pho' },
    update: { approved: true }, // 演示店：补已落库旧店的 approved（upsert 幂等）
    create: {
      slug: 'demo-pho',
      name: 'Phở Demo 88',
      vertical: 'FOOD',
      city: 'hcm',
      approved: true, // 演示店：标入驻，聚合/城市列表可见（listVerifiedShops 按 approved 过滤）
      phone: '0901234567',
      address: '12 Nguyễn Huệ, Q1, TP.HCM',
      config: {
        openHours: '07:00-22:00',
        minOrderAmount: 50000, // 起送价
        image: '/vertical/food.jpg', // 店头图（聚合/门户店铺卡缩略图）
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

  // ================= MOTO 垂直（M1 种子，见 plans/12-moto-implementation.md）=================

  // moto Demo 店（显式 vertical=MOTO；config 从 MotoPreset 预设库拉取写入）
  const motoShop = await prisma.shop.upsert({
    where: { slug: 'demo-moto' },
    update: { approved: true }, // 演示店：补已落库旧店的 approved（upsert 幂等）
    create: {
      slug: 'demo-moto',
      name: 'Demo Moto 88',
      vertical: 'MOTO',
      city: 'hcm',
      approved: true, // 演示店：标入驻，聚合/城市列表可见（listVerifiedShops 按 approved 过滤）
      phone: '0901122334',
      address: '45 Trần Hưng Đạo, Q5, TP.HCM',
      config: {
        openHours: '07:00-19:00',
        image: '/vertical/moto.jpg', // 店头图（聚合/门户店铺卡缩略图）
        // 常见车型（开单分步向导点选，老板可在设置页自定义）
        commonModels: [
          'Honda Wave Alpha',
          'Honda Blade',
          'Honda Lead',
          'Honda Air Blade',
          'Yamaha Sirius',
          'Yamaha Jupiter',
          'Yamaha Exciter',
          'SYM Attila',
          'Piaggio Vespa',
        ],
      },
    },
  })

  // MotoPreset 中台预设库种子（8.2 服务清单，按越南现实高频；价格参考可改）
  const motoPresetsData = [
    // 保养类（bảo dưỡng）
    { serviceKey: 'oil_change', nameVi: 'Thay nhớt máy', nameZh: '换机油', nameEn: 'Engine Oil Change', price: 150000, unit: 'lần', category: '保养', maintenanceType: 'OIL', intervalKm: 2000, intervalDays: 180, sortOrder: 10 },
    { serviceKey: 'maintenance_periodic', nameVi: 'Bảo dưỡng định kỳ', nameZh: '定期保养', nameEn: 'Periodic Maintenance', price: 250000, unit: 'lần', category: '保养', maintenanceType: 'PERIODIC', intervalKm: 4000, intervalDays: 120, sortOrder: 20 },
    { serviceKey: 'injector_clean', nameVi: 'Vệ sinh phun xăng', nameZh: '清洗电喷', nameEn: 'Fuel Injector Cleaning', price: 200000, unit: 'lần', category: '保养', maintenanceType: 'REPAIR', sortOrder: 30 },
    // 维修类（sửa chữa）
    { serviceKey: 'tire_patch', nameVi: 'Vá lốp', nameZh: '补胎', nameEn: 'Tire Patch', price: 50000, unit: 'lỗ', category: '维修', maintenanceType: 'REPAIR', sortOrder: 100 },
    { serviceKey: 'tire_change', nameVi: 'Thay lốp', nameZh: '换胎', nameEn: 'Tire Replacement', price: 350000, unit: 'cái', category: '维修', maintenanceType: 'REPAIR', sortOrder: 110 },
    { serviceKey: 'brake_change', nameVi: 'Thay phanh', nameZh: '换刹车', nameEn: 'Brake Pad Replacement', price: 150000, unit: 'cái', category: '维修', maintenanceType: 'REPAIR', sortOrder: 120 },
    { serviceKey: 'brake_repair', nameVi: 'Sửa phanh', nameZh: '修刹车', nameEn: 'Brake Repair', price: 80000, unit: 'lần', category: '维修', maintenanceType: 'REPAIR', sortOrder: 130 },
    { serviceKey: 'battery_change', nameVi: 'Thay bình ắc quy', nameZh: '换电池', nameEn: 'Battery Replacement', price: 500000, unit: 'cái', category: '维修', maintenanceType: 'REPAIR', sortOrder: 140 },
    { serviceKey: 'spark_change', nameVi: 'Thay bugi', nameZh: '换火花塞', nameEn: 'Spark Plug Replacement', price: 120000, unit: 'cái', category: '维修', maintenanceType: 'REPAIR', sortOrder: 150 },
    { serviceKey: 'chain_change', nameVi: 'Thay xích nhông', nameZh: '换链条齿轮', nameEn: 'Chain & Sprocket Replacement', price: 400000, unit: 'bộ', category: '维修', maintenanceType: 'REPAIR', sortOrder: 160 },
    { serviceKey: 'belt_change', nameVi: 'Thay dây curoa', nameZh: '换皮带', nameEn: 'Belt Replacement', price: 250000, unit: 'cái', category: '维修', maintenanceType: 'REPAIR', sortOrder: 170 },
    { serviceKey: 'electric_repair', nameVi: 'Sửa điện', nameZh: '修线路', nameEn: 'Electrical Repair', price: 150000, unit: 'lần', category: '维修', maintenanceType: 'REPAIR', sortOrder: 180 },
    { serviceKey: 'starter_repair', nameVi: 'Sửa khởi động', nameZh: '修电启动', nameEn: 'Starter Repair', price: 200000, unit: 'lần', category: '维修', maintenanceType: 'REPAIR', sortOrder: 190 },
    // 检查类（kiểm tra）
    { serviceKey: 'general_check', nameVi: 'Kiểm tra tổng quát', nameZh: '全面检查', nameEn: 'General Inspection', price: 100000, unit: 'lần', category: '检查', maintenanceType: 'REPAIR', sortOrder: 300 },
  ]
  for (const p of motoPresetsData) {
    await prisma.motoPreset.upsert({
      where: { serviceKey: p.serviceKey },
      update: { active: true },
      create: {
        serviceKey: p.serviceKey,
        nameVi: p.nameVi,
        nameZh: p.nameZh,
        nameEn: p.nameEn,
        defaultPrice: p.price,
        unit: p.unit,
        category: p.category,
        maintenanceType: p.maintenanceType,
        intervalKm: p.intervalKm ?? null,
        intervalDays: p.intervalDays ?? null,
        sortOrder: p.sortOrder,
      },
    })
  }
  console.log(`MotoPreset 预设库就绪：${motoPresetsData.length} 个服务预设`)

  // Demo 店从预设库拉取 active 预设 → Shop.config.presets（老板开单大按钮数据源）
  const activeMotoPresets = await prisma.motoPreset.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  })
  const motoCfg = (motoShop.config as Record<string, unknown> | null) ?? {}
  await prisma.shop.update({
    where: { id: motoShop.id },
    data: {
      config: {
        ...motoCfg,
        presets: activeMotoPresets.map((mp) => ({
          serviceKey: mp.serviceKey,
          name: mp.nameVi,
          nameZh: mp.nameZh,
          nameEn: mp.nameEn,
          price: mp.defaultPrice.toString(),
          unit: mp.unit,
          category: mp.category,
          maintenanceType: mp.maintenanceType,
          intervalKm: mp.intervalKm,
          intervalDays: mp.intervalDays,
        })),
      },
    },
  })
  console.log(`Demo moto 店「${motoShop.name}」预设大按钮 ${activeMotoPresets.length} 个已就绪`)

  // 测试车 2 台（真实越南车牌格式 59-X1 234.56 → normalize 存 59X123456；ownerPhone 归一化）
  const vehicles = [
    {
      plate: '59X123456',
      brand: 'Honda',
      model: 'Wave Alpha',
      year: 2019,
      mileage: 12000,
      ownerName: 'Nguyễn Văn An',
      ownerPhone: '0923456789',
      notes: '首次建档',
    },
    {
      plate: '59A678123',
      brand: 'Yamaha',
      model: 'Sirius',
      year: 2021,
      mileage: null, // 可空：新车建档无里程
      ownerName: 'Trần Thị Bích',
      ownerPhone: '0934567890',
      notes: '',
    },
  ]
  for (const v of vehicles) {
    await prisma.vehicle.upsert({
      where: { shopId_plate: { shopId: motoShop.id, plate: v.plate } },
      update: {},
      create: { shopId: motoShop.id, ...v },
    })
  }
  console.log(`moto Demo 店测试车 ${vehicles.length} 台就绪（59X123456 / 59A678123）`)

  // moto 店老板账号（手机号登录，与 demo-moto 店 phone 一致；密码同 food demo）
  const motoOwner = await prisma.user.upsert({
    where: { phone: '0901122334' },
    update: {},
    create: {
      shopId: motoShop.id,
      phone: '0901122334',
      passwordHash: await hash('demo1234', 10),
      name: 'Chủ tiệm moto',
      role: 'OWNER',
    },
  })
  console.log(`moto 店老板账号就绪：${motoOwner.phone} / demo1234`)

  // ================= LAUNDRY 垂直（垂直2 · plans/work/laundry.md）=================
  // laundry Demo 店：显式 vertical=LAUNDRY + 默认配价（kg/件/洗鞋）+ 标签码自增 + 2 测试订单
  const laundShop = await prisma.shop.upsert({
    where: { slug: 'demolaud' },
    update: { approved: true },
    create: {
      slug: 'demolaud',
      name: 'Giặt ủi Demo 88',
      vertical: 'LAUNDRY',
      city: 'hcm',
      approved: true,
      phone: '0901122335',
      address: '88 Lý Thường Kiệt, Q10, TP.HCM',
      config: {
        openHours: '07:00-20:30',
        image: '/vertical/laundry.jpg',
        laundryTagSeq: 2,
        laundryRates: {
          kgRate: 20000,
          itemRates: [
            { name: 'Áo sơ mi', nameZh: '衬衫', nameEn: 'Shirt', price: 30000 },
            { name: 'Quần jeans', nameZh: '牛仔裤', nameEn: 'Jeans', price: 30000 },
            { name: 'Áo thun', nameZh: 'T恤', nameEn: 'T-shirt', price: 25000 },
            { name: 'Áo khoác', nameZh: '外套', nameEn: 'Jacket', price: 45000 },
            { name: 'Váy', nameZh: '裙子', nameEn: 'Dress', price: 40000 },
            { name: 'Chăn mỏng', nameZh: '薄被', nameEn: 'Blanket', price: 60000 },
          ],
          shoeBase: { sport: 40000, leather: 60000, suede: 70000 },
          shoeAddons: [
            { name: 'Khử mùi', nameZh: '除臭', nameEn: 'Deodorize', price: 20000 },
            { name: 'Tẩy vết ố', nameZh: '去渍', nameEn: 'Stain removal', price: 30000 },
          ],
        },
      },
    },
  })

  // laundry 店老板账号（手机号登录；密码同 food/moto demo）
  await prisma.user.upsert({
    where: { phone: '0901122335' },
    update: {},
    create: {
      shopId: laundShop.id,
      phone: '0901122335',
      passwordHash: await hash('demo1234', 10),
      name: 'Chủ tiệm giặt',
      role: 'OWNER',
    },
  })

  // 2 台测试订单（演示待取催取 + 待洗）：displayNo/orderNo 按店唯一，幂等 upsert
  const dayPrefix = '260901'
  const testOrders = [
    {
      displayNo: `LD-${dayPrefix}-001`,
      orderNo: 1,
      status: 'READY',
      total: 220000,
      paidAmount: 220000,
      customerPhone: '0987654321',
      customerName: 'Chị Lan',
      config: { laundryMode: 'kg', laundryStatus: 'ready', tagCode: '#001', kg: 8, discount: 0 },
    },
    {
      displayNo: `LD-${dayPrefix}-002`,
      orderNo: 2,
      status: 'PENDING',
      total: 60000,
      paidAmount: 0,
      customerPhone: '0901111222',
      customerName: 'Anh Minh',
      config: { laundryMode: 'shoe', laundryStatus: 'washing_pending', tagCode: '#002', shoeStyle: 'sport', shoeAddonNames: ['Khử mùi'], discount: 0 },
    },
  ]
  for (const o of testOrders) {
    const created = await prisma.order.upsert({
      where: { shopId_displayNo: { shopId: laundShop.id, displayNo: o.displayNo } },
      update: {},
      create: {
        shopId: laundShop.id,
        orderNo: o.orderNo,
        displayNo: o.displayNo,
        status: o.status as never,
        total: o.total,
        paidAmount: o.paidAmount,
        customerPhone: o.customerPhone,
        customerName: o.customerName,
        items: [],
        config: o.config,
      },
    })
    // 待取单已生成「催取」提醒（老板端到点冒泡 + 一键复制发 Zalo）
    if (o.status === 'READY') {
      await prisma.reminder.create({
        data: {
          shopId: laundShop.id,
          orderId: created.id,
          templateKey: 'LAUNDRY_READY',
          dueAt: new Date(),
          status: 'PENDING',
          payload: { displayNo: o.displayNo, tagCode: '#001', customerPhone: o.customerPhone, customerName: o.customerName, total: o.total },
        },
      })
    }
  }
  console.log(`laundry Demo 店就绪：${laundShop.slug}（老板 0901122335 / demo1234，2 测试订单）`)

  // ================= 多城市演示店扩展（让城市/垂直切换都有内容）=================
  // 现状：只有 hcm 的 demo-pho/demo-moto。为让聚合/门户切到河内(hn)、岘港(dn)也「跟走」，
  // 给每个城市 × 每个垂直补 1 家演示店（幂等 upsert by slug；仅建店骨架，商品/预设沿用各垂直 demo）。
  // 垂直展示名用 admin 命名空间；SALON/PET/LAUNDRY 暂只建店（后续垂直模块接入后再补商品流程）。
  const VERTICAL_DEMO_META: Record<string, { name: string; phone: string }> = {
    FOOD: { name: 'Phở', phone: '0902111001' },
    MOTO: { name: 'Moto', phone: '0902111002' },
    SALON: { name: 'Salon', phone: '0902111003' },
    PET: { name: 'Pet', phone: '0902111004' },
    LAUNDRY: { name: 'Giặt ủi', phone: '0902111005' },
  }

  // hcm 已有 demo-pho/demo-moto（首店），这里为 hn/dn 各垂直补店；
  // 同时为 hcm 的 SALON/PET/LAUNDRY 也各建一家（否则这三个垂直首层进 hcm 也是空）。
  const citySeedPlan = ['hn', 'dn'] // 除 hcm（已有首店）外的城市
  const seeded: string[] = []
  for (const citySlug of ['hcm', ...citySeedPlan]) {
    const meta = CITIES.find((c) => c.slug === citySlug)
    for (const [vertical, vmeta] of Object.entries(VERTICAL_DEMO_META)) {
      // hcm 的 FOOD/MOTO 已有 flagship 店（demo-pho/demo-moto），不重复建
      if (citySlug === 'hcm' && (vertical === 'FOOD' || vertical === 'MOTO')) continue
      const slug = `demo-${vertical.toLowerCase()}-${citySlug}`
      await prisma.shop.upsert({
        where: { slug },
        update: { approved: true }, // 演示店：补已落库旧店的 approved（upsert 幂等）
        create: {
          slug,
          name: `${vmeta.name} ${meta?.nameEn ?? citySlug}`,
          vertical: vertical as never,
          city: citySlug as never,
          approved: true, // 演示店：标入驻，聚合/城市列表可见（listVerifiedShops 按 approved 过滤）
          phone: vmeta.phone,
          address: `${meta?.nameEn ?? citySlug} demo store`,
          config: { openHours: '07:00-22:00' },
        },
      })
      seeded.push(slug)
    }
  }
  console.log(`多城市演示店就绪 ${seeded.length} 家：${seeded.join(', ')}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
