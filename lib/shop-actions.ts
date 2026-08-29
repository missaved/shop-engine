// 客户侧 server actions：点单（客户未登录，不做 requireUser，改校验营业/售罄/商品归属）
// 租户隔离：shopId 一律由 slug 服务端派生（getShopBySlug），客户端永不传 shopId
'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { getShopBySlug } from '@/lib/tenant'
import { isShopExpired } from '@/lib/billing'
import { formatPrice } from '@/lib/format'
import { isRateLimited, recordFailure } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/phone'
import {
  aggregateCartItems,
  itemSubtotal,
  priceCartItems,
  type CartItem,
  type StoredOrderItem,
} from '@/lib/cart-pricing'

export type OrderType = 'dine_in' | 'takeaway' | 'delivery'

// 下单安全上限（防伪造/异常输入，P0-3）
// 手机号正则：归一化后纯数字，兼容越南 0 开头 10 位 / 中国 11 位 / 国际号（+86/+84 在 normalizePhone 已换算）
const PHONE_RE = /^\d{7,15}$/
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
  if (shop.platformSuspended) throw new Error('店铺暂停营业')
  if (await isShopExpired(shop)) throw new Error('店铺已到期')

  const shopCfg = (shop.config as Record<string, unknown> | null) ?? {}
  if (!isOpenNow(shopCfg.openHours as string | undefined)) {
    throw new Error('当前不在营业时间')
  }

  const orderType = input.orderType ?? 'dine_in'
  // 桌号仅堂食（dine_in）有意义：扫码预填后切外带/外送的单不持久化 tableNo（防脏数据/提醒 payload 带桌号）
  const tableNo = orderType === 'dine_in' ? input.tableNo?.trim() || undefined : undefined
  const address = input.address?.trim() || undefined
  // 堂食打包（收打包费）；外送自取（到店取，免配送费、地址/手机号非必填）
  const packing = input.packing === true
  const pickup = input.pickup === true
  if (orderType === 'delivery' && !pickup && !address) throw new Error('外送请填写地址')

  // 手机号：仅外送（非自取）强制；自取/堂食/外带可选（现场点单/取餐无需手机）
  // 归一化后再存/校验：+86/+84、空格/连字符写法统一为本地号，保证查单精确匹配命中
  const phone = input.customerPhone ? normalizePhone(input.customerPhone) || undefined : undefined
  if (orderType === 'delivery' && !pickup) {
    if (!phone) throw new Error('外送请填写手机号')
    if (!PHONE_RE.test(phone)) throw new Error('手机号格式不正确')
  } else if (phone && !PHONE_RE.test(phone)) {
    // 若填了手机号，仍校验格式（避免脏数据）
    throw new Error('手机号格式不正确')
  }

  // 聚合数量 + 合并加料 + 规格（防同一商品重复项，过滤无效/非正 qty；M7/M8 类型与聚合上限校验）
  const { qtyMap, extrasMap, optionsMap, error: aggError } = aggregateCartItems(input.items)
  if (aggError === 'overflow') throw new Error('单个商品数量超出上限')
  if (aggError === 'invalid') throw new Error('商品信息有误')
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

    // 服务端计价：加料价 + 规格价都从 Product.config 查，不信任客户端传价（复用 lib/cart-pricing）
    const { items: orderItems, subtotal } = await priceCartItems({
      shopId: shop.id,
      qtyMap,
      extrasMap,
      optionsMap,
    })

    // 配送费：仅外送（非自取）；打包费：堂食打包。起送价仍按商品小计判断，运费另算
    const deliveryFee = orderType === 'delivery' && !pickup ? Number(shopCfg.deliveryFee ?? 0) : 0
    const packingFee = orderType === 'dine_in' && packing ? Number(shopCfg.packingFee ?? 0) : 0
    const total = subtotal + deliveryFee + packingFee

    // 金额上限校验（P0-3，防伪造巨款/数值溢出）
    if (total > MAX_ORDER_AMOUNT) throw new Error('订单金额超出上限')

    // 起送价校验（A9）：仅外送模式生效（堂食/外带不卡起送），按商品小计判断
    const minOrderAmount = Number(shopCfg.minOrderAmount ?? 0)
    if (orderType === 'delivery' && !pickup && minOrderAmount > 0 && subtotal < minOrderAmount) {
      throw new Error(`未达起送价 ${formatPrice(minOrderAmount, shop.currency)}`)
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
  const phone = input.phone ? normalizePhone(input.phone) : ''
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
// 第18批 频率限制：按「上次发送时间」双窗口限流（防滥用，用户确认规则）——
// ① 同一来源距最近一次呼叫 <60s 拒绝（1 分钟最多 1 次）；② 5 分钟内 ≥2 条拒绝（5 分钟最多 2 次）。
// 同一来源：堂食按桌号锁定（同桌反复呼叫），无桌号退回 IP 维度。超限抛稳定错误码 CALL_TOO_FREQUENT，前端按 locale 映射。
export async function callWaiter(input: {
  slug: string
  tableNo?: string
  phone?: string
}): Promise<void> {
  const shop = await getShopBySlug(input.slug)
  try {
    const now = new Date()
    const since = new Date(now.getTime() - 5 * 60 * 1000)
    const h = await headers()
    const fwd = h.get('x-forwarded-for')
    const ip = (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip')?.trim()) || 'unknown'
    const tableNo = input.tableNo?.trim() || null

    // 近 5 分钟该店呼叫记录（低频事件，全量查回内存过滤，免复杂 Json 路径查询）
    const recent = await prisma.reminder.findMany({
      where: { shopId: shop.id, templateKey: 'CALL_WAITER', createdAt: { gte: since } },
      select: { createdAt: true, payload: true },
    })
    const sameSource = recent.filter((r) => {
      const p = (r.payload as Record<string, unknown>) ?? {}
      if (tableNo) return p.tableNo === tableNo
      return p.ip === ip
    })
    if (sameSource.some((r) => now.getTime() - r.createdAt.getTime() < 60 * 1000)) {
      throw new Error('CALL_TOO_FREQUENT') // 规则①：1 分钟内最多 1 次
    }
    if (sameSource.length >= 2) {
      throw new Error('CALL_TOO_FREQUENT') // 规则②：5 分钟内最多 2 次
    }

    await prisma.reminder.create({
      data: {
        shopId: shop.id,
        orderId: null,
        templateKey: 'CALL_WAITER',
        dueAt: new Date(),
        status: 'PENDING',
        payload: {
          tableNo: input.tableNo?.trim() || null,
          customerPhone: input.phone ? normalizePhone(input.phone) || null : null,
          ip, // 频率限制维度：无桌号时按 IP 判同源（第18批）
        },
      },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('呼叫服务员失败（slug=%s）:', input.slug, e)
    throw e
  }
}

// P0 客户自助加菜（游客可调，无 requireOwner）：guestKey（游客 cookie）或 orderNo+phone 锁单，
// 服务端计价 + 费用守恒，校验订单未结束；READY（待取餐）阶段按商品 canAddOn 属性限制
//（烧烤摊取餐后临时加饮料/小菜可行，未标「可追加」的菜不行）。成功后建 FOOD_ADD 待办给老板「去处理」。
// 入参 guestKey 由调用方传入解码值（track 页读 cookie 已 decode），action 内直接比较不再 decode。
// 错误统一抛稳定错误码（ORDER_NOT_FOUND / ORDER_NOT_ADDABLE / ITEM_NOT_ADDABLE / AMOUNT_OVER / NO_ITEMS / RATE_LIMITED / ADD_FAILED），
// 前端按 locale 映射，不向客户直出中文。
export async function addItemsToMyOrder(input: {
  slug: string
  orderNo: string
  items: CartItem[]
  phone?: string
  guestKey?: string
}): Promise<{ displayNo: string; addedSubtotal: number }> {
  const shop = await getShopBySlug(input.slug)
  if (shop.platformSuspended) throw new Error('ORDER_NOT_ADDABLE')
  if (await isShopExpired(shop)) throw new Error('ORDER_NOT_ADDABLE')

  const gk = input.guestKey?.trim() ?? ''
  const p = input.phone ? normalizePhone(input.phone) : ''
  const no = input.orderNo?.trim() ?? ''
  // M3 空凭证守卫：防 Prisma 忽略 undefined → 退化成「无凭证匹配任意该 displayNo 订单」
  if (!no || (!gk && !p)) throw new Error('ORDER_NOT_FOUND')

  // 限流：IP + 凭证双 key（防枚举/刷单，复用查单同一套计数，5 次失败/60s）
  const h = await headers()
  const fwd = h.get('x-forwarded-for')
  const ip = (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip')?.trim()) || 'unknown'
  const keyIp = `track:ip:${ip}`
  const keyCred = gk ? `track:gk:${gk}` : `track:phone:${p}`
  if (isRateLimited(keyIp) || isRateLimited(keyCred)) throw new Error('RATE_LIMITED')

  // 聚合 + 运行时校验（M7/M8：qty 聚合上限 / extras、options 类型）
  const { qtyMap, extrasMap, optionsMap, error: aggError } = aggregateCartItems(input.items)
  if (aggError === 'overflow') throw new Error('NO_ITEMS')
  if (qtyMap.size === 0) throw new Error('NO_ITEMS')

  try {
    // 定位订单（凭证匹配本人订单）；未命中记录失败（防枚举）
    const matched = await prisma.order.findFirst({
      where: gk
        ? { shopId: shop.id, displayNo: no, config: { path: ['guestKey'], equals: gk } }
        : { shopId: shop.id, displayNo: no, customerPhone: p },
      select: { id: true },
    })
    if (!matched) {
      recordFailure(keyIp)
      recordFailure(keyCred)
      throw new Error('ORDER_NOT_FOUND')
    }

    // 服务端计价（不信任客户端传价）
    const { items: addItems, subtotal: addSubtotal, canAddOnById } = await priceCartItems({
      shopId: shop.id,
      qtyMap,
      extrasMap,
      optionsMap,
    })

    // 事务锁单重读（M2）：锁 Order 行 + 锁内重读状态/items/total，防与老板侧/并发加菜丢更新
    const order = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${matched.id} FOR UPDATE`
      const cur = await tx.order.findUnique({
        where: { id: matched.id },
        select: { id: true, displayNo: true, status: true, items: true, total: true },
      })
      if (!cur) throw new Error('ORDER_NOT_FOUND')
      // 订单未结束才可加：PENDING/IN_PROGRESS/READY 均可；COMPLETED/CANCELLED 拒绝
      if (cur.status === 'COMPLETED' || cur.status === 'CANCELLED') {
        throw new Error('ORDER_NOT_ADDABLE')
      }
      // READY（待取餐）阶段：仅商品标了「可追加」（canAddOn）才能加（⑤-3，锁内状态重查后再校验）
      if (cur.status === 'READY') {
        const blocked = addItems.some((it) => {
          // 旧商品 config 缺 canAddOn → 默认可追加（用户拍板）
          return it.productId != null && (canAddOnById.get(it.productId) ?? true) === false
        })
        if (blocked) throw new Error('ITEM_NOT_ADDABLE')
      }

      // 费用守恒：fee = 旧 total − 旧 subtotal，加菜只加 subtotal
      const oldItems = (cur.items as unknown as StoredOrderItem[]) ?? []
      const oldSubtotal = oldItems.reduce((s, it) => s + itemSubtotal(it), 0)
      const fee = Number(cur.total) - oldSubtotal
      const newTotal = oldSubtotal + addSubtotal + fee
      if (newTotal > MAX_ORDER_AMOUNT) throw new Error('AMOUNT_OVER')

      return tx.order.update({
        where: { id: cur.id },
        data: {
          items: [...oldItems, ...addItems] as Prisma.InputJsonValue,
          total: newTotal,
          // 已上桌(READY)后加菜：新菜仍需制作 → 回退处理中，boss 端推进按钮恢复，可再推进到 READY
          ...(cur.status === 'READY' ? { status: 'IN_PROGRESS' as const } : {}),
        },
        select: { id: true, displayNo: true },
      })
    })

    // FOOD_ADD 待办（事务外，锁不占久）：老板端冒泡，留到「去处理/忽略」或终态才清（不做 5s 自动消失）
    const itemsSummary = addItems.map((it) => ({ name: it.name, qty: it.qty }))
    await prisma.reminder.create({
      data: {
        shopId: shop.id,
        orderId: order.id,
        templateKey: 'FOOD_ADD',
        dueAt: new Date(),
        status: 'PENDING',
        payload: {
          displayNo: order.displayNo,
          customerName: null,
          customerPhone: p || null,
          total: addSubtotal,
          orderType: null,
          tableNo: null,
          items: itemsSummary,
          guestKey: gk || null,
        },
      },
    })
    revalidatePath('/[locale]/dashboard', 'page')
    return { displayNo: order.displayNo, addedSubtotal: addSubtotal }
  } catch (e) {
    if (e instanceof Error) {
      const codes = [
        'ORDER_NOT_FOUND',
        'ORDER_NOT_ADDABLE',
        'ITEM_NOT_ADDABLE',
        'AMOUNT_OVER',
        'NO_ITEMS',
        'RATE_LIMITED',
      ]
      // 稳定错误码直接透传（前端按 locale 映射，不向客户直出中文）
      if (codes.includes(e.message)) throw e
      // priceCartItems 的售罄中文错误 → 转稳定码
      if (e.message === '部分商品已售罄或不存在') throw new Error('NO_ITEMS')
      console.error('客户加菜失败（slug=%s, orderNo=%s）:', input.slug, input.orderNo, e)
      throw new Error('ADD_FAILED')
    }
    throw e
  }
}
