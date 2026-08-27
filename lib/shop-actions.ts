// 客户侧 server actions：点单（客户未登录，不做 requireUser，改校验营业/售罄/商品归属）
// 租户隔离：shopId 一律由 slug 服务端派生（getShopBySlug），客户端永不传 shopId
'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { getShopBySlug } from '@/lib/tenant'

export type CartItem = {
  productId: string
  qty: number
  extras?: string[]
  // 规格选择：规格组名 -> 选中选项名
  options?: Record<string, string>
}
export type OrderType = 'dine_in' | 'takeaway' | 'delivery'

// 下单安全上限（防伪造/异常输入，P0-3）
const PHONE_RE = /^0\d{9,10}$/ // 越南手机号：0 开头，9~10 位
const MAX_QTY_PER_ITEM = 99 // 单商品数量上限（餐饮单合理值，防 qty 传超大数致金额溢出）
const MAX_ORDER_AMOUNT = 50_000_000 // 单订单金额上限（VND，防伪造巨款单）

// 营业时间是否在营业中（openHours 字符串 "07:00-22:00"，支持跨午夜）
function isOpenNow(openHours?: string): boolean {
  if (!openHours) return true
  const [start, end] = openHours.split('-').map((s) => s.trim())
  if (!start || !end) return true
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }
  const now = new Date()
  const cur = now.getHours() * 60 + now.getMinutes()
  const s = toMin(start)
  const e = toMin(end)
  if (s < e) return cur >= s && cur < e
  return cur >= s || cur < e // 跨午夜
}

// 客户点单：服务端计价（不信任客户端传价）+ 校验营业时间/售罄/起送价/商品归属
export async function createOrder(input: {
  slug: string
  items: CartItem[]
  customerPhone: string
  customerName?: string
  orderType?: OrderType
  tableNo?: string
  address?: string
  note?: string
  idempotencyKey?: string
  packing?: boolean
  pickup?: boolean
  guestKey?: string
}): Promise<{ orderNo: number; displayNo: string }> {
  const shop = await getShopBySlug(input.slug)
  if (!shop.open) throw new Error('店铺已打烊')

  const shopCfg = (shop.config as Record<string, unknown> | null) ?? {}
  if (!isOpenNow(shopCfg.openHours as string | undefined)) {
    throw new Error('当前不在营业时间')
  }

  const orderType = input.orderType ?? 'dine_in'
  const tableNo = input.tableNo?.trim() || undefined
  const address = input.address?.trim() || undefined
  // 堂食打包（收打包费）；外送自取（到店取，免配送费、地址/手机号非必填）
  const packing = input.packing === true
  const pickup = input.pickup === true
  if (orderType === 'delivery' && !pickup && !address) throw new Error('外送请填写地址')

  // 手机号：仅外送（非自取）强制；自取/堂食/外带可选（现场点单/取餐无需手机）
  const phone = input.customerPhone?.trim() || undefined
  if (orderType === 'delivery' && !pickup) {
    if (!phone) throw new Error('外送请填写手机号')
    if (!PHONE_RE.test(phone)) throw new Error('手机号格式不正确')
  } else if (phone && !PHONE_RE.test(phone)) {
    // 若填了手机号，仍校验格式（避免脏数据）
    throw new Error('手机号格式不正确')
  }

  // 聚合数量 + 合并加料 + 规格（防同一商品重复项，过滤无效/非正 qty）
  const qtyMap = new Map<string, number>()
  const extrasMap = new Map<string, string[]>()
  const optionsMap = new Map<string, Record<string, string>>()
  for (const it of input.items ?? []) {
    const q = Math.trunc(Number(it.qty))
    if (!Number.isFinite(q) || q <= 0 || q > MAX_QTY_PER_ITEM) continue
    qtyMap.set(it.productId, (qtyMap.get(it.productId) ?? 0) + q)
    if (it.extras?.length) extrasMap.set(it.productId, it.extras)
    if (it.options) optionsMap.set(it.productId, it.options)
  }
  if (qtyMap.size === 0) throw new Error('请至少选择一件商品')

  const idempotencyKey = input.idempotencyKey?.trim() || null
  const guestKey = input.guestKey?.trim() || undefined

  try {
    // P0-7 幂等去重：同一键的重复提交直接返回已建订单（防双击/请求重放）
    if (idempotencyKey) {
      const existing = await prisma.order.findUnique({
        where: { shopId_idempotencyKey: { shopId: shop.id, idempotencyKey } },
      })
      if (existing) return { orderNo: existing.orderNo, displayNo: existing.displayNo }
    }

    const products = await prisma.product.findMany({
      where: { id: { in: [...qtyMap.keys()] }, shopId: shop.id, active: true },
    })
    // 找到的商品数 ≠ 请求的商品数 → 有售罄/越权/不存在的项
    if (products.length !== qtyMap.size) throw new Error('部分商品已售罄或不存在')

    // 服务端计价：加料价 + 规格价都从 Product.config 查，不信任客户端传价
    const orderItems = products.map((p) => {
      const cfg = p.config as {
        extras?: { name: string; price: number }[]
        optionGroups?: { name: string; options: { name: string; price?: number }[] }[]
        combo?: { name: string; qty: number }[]
      } | null
      const chosenNames = extrasMap.get(p.id) ?? []
      const extras = (cfg?.extras ?? [])
        .filter((ex) => chosenNames.includes(ex.name))
        .map((ex) => ({ name: ex.name, price: Number(ex.price) }))
      // 规格：按 optionGroups 查选中选项的加价；未选中/非法选项丢弃
      const chosenOptions = optionsMap.get(p.id) ?? {}
      const options = (cfg?.optionGroups ?? [])
        .map((g) => {
          const opt = g.options.find((o) => o.name === chosenOptions[g.name])
          return opt ? { group: g.name, name: opt.name, price: Number(opt.price ?? 0) } : null
        })
        .filter((o): o is { group: string; name: string; price: number } => o !== null)
      return {
        productId: p.id,
        name: p.name,
        qty: qtyMap.get(p.id)!,
        price: Number(p.price),
        extras,
        options,
        combo: (cfg?.combo ?? []).map((c) => ({ name: c.name, qty: c.qty })),
      }
    })
    const subtotal = orderItems.reduce((sum, it) => {
      const extrasSum = it.extras.reduce((s, ex) => s + ex.price, 0)
      const optionsSum = it.options.reduce((s, g) => s + g.price, 0)
      return sum + (it.price + extrasSum + optionsSum) * it.qty
    }, 0)

    // 配送费：仅外送（非自取）；打包费：堂食打包。起送价仍按商品小计判断，运费另算
    const deliveryFee = orderType === 'delivery' && !pickup ? Number(shopCfg.deliveryFee ?? 0) : 0
    const packingFee = orderType === 'dine_in' && packing ? Number(shopCfg.packingFee ?? 0) : 0
    const total = subtotal + deliveryFee + packingFee

    // 金额上限校验（P0-3，防伪造巨款/数值溢出）
    if (total > MAX_ORDER_AMOUNT) throw new Error('订单金额超出上限')

    // 起送价校验（A9）：仅外送模式生效（堂食/外带不卡起送），按商品小计判断
    const minOrderAmount = Number(shopCfg.minOrderAmount ?? 0)
    if (orderType === 'delivery' && !pickup && minOrderAmount > 0 && subtotal < minOrderAmount) {
      throw new Error(`未达起送价 ${minOrderAmount.toLocaleString('vi-VN')}đ`)
    }

    // 对外订单号 CP-YYMMDD-NNN（NNN 当日自增，按 displayNo 前缀统计）
    const now = new Date()
    const dayPrefix =
      String(now.getFullYear()).slice(-2) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0')

    // P1-3 并发安全：事务 + FOR UPDATE 锁 shop 行，串行化同店「取号 + 建单」（create 也在锁内，防取号与建单之间被插队撞号 P2002）
    const order = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Shop" WHERE id = ${shop.id} FOR UPDATE`
      const max = await tx.order.aggregate({
        where: { shopId: shop.id },
        _max: { orderNo: true },
      })
      const orderNo = (max._max.orderNo ?? 0) + 1
      // 当日序号取「当日最大 displayNo 序号 + 1」，而非 count+1（订单有空洞/删除时会撞号 P2002）
      const lastOrder = await tx.order.findFirst({
        where: { shopId: shop.id, displayNo: { startsWith: `CP-${dayPrefix}-` } },
        orderBy: { displayNo: 'desc' },
        select: { displayNo: true },
      })
      const lastSeq = lastOrder?.displayNo
        ? Number(lastOrder.displayNo.split('-').pop() ?? '0')
        : 0
      const displayNo = `CP-${dayPrefix}-${String(lastSeq + 1).padStart(3, '0')}`
      // 游客标识：guestKey（cookie）+ guestIp（下单网络），供查单锁定本人订单（免填订单号）
      const h = await headers()
      const fwd = h.get('x-forwarded-for')
      const guestIp =
        (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip')?.trim()) || undefined

      return tx.order.create({
        data: {
          orderNo,
          displayNo,
          shopId: shop.id,
          status: 'PENDING',
          items: orderItems as Prisma.InputJsonValue,
          total,
          paidAmount: 0,
          customerName: input.customerName?.trim() || null,
          customerPhone: phone ?? null,
          note: input.note?.trim() || null,
          idempotencyKey,
          config: {
            orderType,
            ...(tableNo ? { tableNo } : {}),
            ...(address ? { address } : {}),
            ...(packing ? { packing: true } : {}),
            ...(pickup ? { pickup: true } : {}),
            ...(guestKey ? { guestKey } : {}),
            ...(guestIp ? { guestIp } : {}),
          },
        },
      })
    })

    // D1 新单冒泡：创建到点提醒（老板一键复制发 Zalo）
    // payload 附带订单类型/桌号/菜品摘要，供待办一目了然 + 点击跳单
    const itemsSummary = orderItems.map((it) => ({ name: it.name, qty: it.qty }))
    await prisma.reminder.create({
      data: {
        shopId: shop.id,
        orderId: order.id,
        templateKey: 'FOOD_NEW_ORDER',
        dueAt: now,
        status: 'PENDING',
        payload: {
          displayNo: order.displayNo,
          customerName: input.customerName?.trim() || null,
          customerPhone: phone ?? null,
          total,
          orderType,
          tableNo: tableNo ?? null,
          items: itemsSummary,
        },
      },
    })
    revalidatePath('/[locale]/dashboard', 'page')
    return { orderNo: order.orderNo, displayNo: order.displayNo }
  } catch (e) {
    // P0-7 并发双击：unique 冲突（P2002）→ 另一请求已建单，查回已建订单返回
    if (
      idempotencyKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const existing = await prisma.order.findUnique({
        where: { shopId_idempotencyKey: { shopId: shop.id, idempotencyKey } },
      })
      if (existing) return { orderNo: existing.orderNo, displayNo: existing.displayNo }
    }
    console.error('点单失败（slug=%s）:', input.slug, e)
    throw e
  }
}

// P2-1 PDPD 一键删除我的数据：客户删除本单个人数据（手机号/姓名/备注 → 匿名化），
// 保留订单号/金额/状态供老板对账；清关联提醒 payload 里的 PII
export async function deleteMyData(input: {
  slug: string
  orderNo: string
  phone?: string
  guestKey?: string
}): Promise<void> {
  const shop = await getShopBySlug(input.slug)
  const phone = input.phone?.trim() ?? ''
  const guestKey = input.guestKey?.trim() ?? ''
  const orderNo = input.orderNo?.trim()
  if (!orderNo || (!phone && !guestKey)) throw new Error('参数缺失')

  const order = await prisma.order.findFirst({
    where: guestKey
      ? { shopId: shop.id, displayNo: orderNo, config: { path: ['guestKey'], equals: guestKey } }
      : { shopId: shop.id, displayNo: orderNo, customerPhone: phone },
  })
  if (!order) throw new Error('订单不存在或手机号不匹配')

  await prisma.order.update({
    where: { id: order.id },
    data: { customerPhone: null, customerName: null, note: null },
  })

  // 清关联提醒 payload 的客户 PII（displayNo/total 保留）
  const reminders = await prisma.reminder.findMany({ where: { orderId: order.id } })
  for (const r of reminders) {
    const p = (r.payload as Record<string, unknown>) ?? {}
    await prisma.reminder.update({
      where: { id: r.id },
      data: {
        payload: { ...p, customerPhone: null, customerName: null } as Prisma.InputJsonValue,
      },
    })
  }
}

// 客户呼叫服务员（找服务员买水/买单/其他需求）：创建 CALL_WAITER 提醒，老板端冒泡 + 声音
export async function callWaiter(input: {
  slug: string
  tableNo?: string
  phone?: string
}): Promise<void> {
  const shop = await getShopBySlug(input.slug)
  try {
    await prisma.reminder.create({
      data: {
        shopId: shop.id,
        orderId: null,
        templateKey: 'CALL_WAITER',
        dueAt: new Date(),
        status: 'PENDING',
        payload: {
          tableNo: input.tableNo?.trim() || null,
          customerPhone: input.phone?.trim() || null,
        },
      },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('呼叫服务员失败（slug=%s）:', input.slug, e)
    throw e
  }
}
