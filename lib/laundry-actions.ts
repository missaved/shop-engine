'use server'
// LAUNDRY 老板端 server actions：三模式快速开单 + 状态推进 + 收款 + 设置 + 提醒 + 今日统计
// 全部 requireOwner + assertShopOwned（租户隔离）；LAUNDRY 专属动作再校验 vertical（laundryStatus 只作用于 laundry 店订单）。
// 计费复用 MOTO 模式：COUNT 走 order-shared 公共取号；计价从 Shop.config.laundryRates 服务端重算（不信任客户端传价）。
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireOwner, requireCustomer } from '@/lib/dal'
import { auth } from '@/auth'
import { assertShopOwned } from '@/lib/tenant'
import { normalizePhone } from '@/lib/phone'
import { vietnamTodayStartUtc } from '@/lib/dashboard-orders'
import {
  MAX_ORDER_AMOUNT,
  lockShopForUpdate,
  nextOrderNumbers,
  findIdempotentOrder,
} from '@/lib/order-shared'
import type { LaundryMode, LaundryRates, ShoeStyle } from '@/components/laundry/types'

// —— 常量 ——
// 细分状态流（唯一权威，含质检 QC/配送）：待洗 → 洗涤中 → 质检 → 待取（Chờ lấy）→ 结单
const PROGRESS_SEQ = ['washing_pending', 'washing', 'qc', 'ready', 'collected'] as const
const PROGRESS_STATUS: Record<string, string> = {
  washing_pending: 'PENDING',
  washing: 'IN_PROGRESS',
  qc: 'IN_PROGRESS',
  ready: 'READY',
  collected: 'COMPLETED',
}
export type LaundryProgress = (typeof PROGRESS_SEQ)[number]

// 逾期分级（L_OVERDUE）：>3 天 / >7 天（模块内常量，勿导出——'use server' 文件只允许导出 async 函数）
const OVERDUE_DAYS_1 = 3
const OVERDUE_DAYS_2 = 7

// 标签码 3 位
const TAG_CODE_MAX = 999

function readRates(shop: { config?: Prisma.JsonValue | null } | null): LaundryRates | null {
  const cfg = (shop?.config ?? {}) as Record<string, unknown>
  return (cfg.laundryRates as LaundryRates | undefined) ?? null
}

// 按模式重算 total（服务端权威：公斤=kg×单价 / 按件=Σ单价×件数 / 洗鞋=款式底价+Σ增值）
function computeLaundryTotal(
  rates: LaundryRates,
  input: {
    mode: LaundryMode
    kg?: number
    itemSelections?: { name: string; qty: number }[]
    shoeStyle?: ShoeStyle | null
    shoeAddons?: string[]
  },
): { total: number; details: { name: string; qty: number; price: number }[] } {
  if (input.mode === 'kg') {
    const kg = Math.max(Number(input.kg ?? 0), 0)
    const price = rates.kgRate
    const total = Math.round(kg * price)
    return { total, details: [{ name: 'kg', qty: kg, price }] }
  }
  if (input.mode === 'item') {
    const details = (input.itemSelections ?? [])
      .map((s) => {
        const rate = rates.itemRates.find((r) => r.name === s.name)
        const qty = Math.max(Math.trunc(Number(s.qty ?? 0)), 0)
        if (!rate || qty <= 0) return null
        return { name: rate.name, qty, price: rate.price }
      })
      .filter((d): d is { name: string; qty: number; price: number } => d !== null)
    const total = details.reduce((s, d) => s + d.price * d.qty, 0)
    return { total, details }
  }
  // shoe
  const base = input.shoeStyle ? rates.shoeBase[input.shoeStyle] ?? 0 : 0
  const addons = (input.shoeAddons ?? [])
    .map((name) => rates.shoeAddons.find((a) => a.name === name))
    .filter((a): a is { name: string; price: number } => Boolean(a))
  const total = base + addons.reduce((s, a) => s + a.price, 0)
  const details = [{ name: input.shoeStyle ?? 'shoe', qty: 1, price: base }, ...addons.map((a) => ({ name: a.name, qty: 1, price: a.price }))]
  return { total, details }
}

// —— 开单 ——
export async function createLaundryOrder(input: {
  mode: LaundryMode
  kg?: number
  itemSelections?: { name: string; qty: number }[]
  shoeStyle?: ShoeStyle | null
  shoeAddons?: string[]
  customerPhone?: string
  customerName?: string
  note?: string
  discount?: number
  paidAmount?: number
  idempotencyKey?: string
  photos?: string[]
  careType?: string
  dispatchType?: 'in_store' | 'pickup' | 'deliver'
  address?: string
  deliveryFee?: number
  timeWindow?: string
}) {
  const user = await requireOwner()
  const shop = await prisma.shop.findUnique({ where: { id: user.shopId } })
  const rates = readRates(shop)
  if (!rates) throw new Error('请先到设置里配置计价')
  if (!input.mode) throw new Error('请选择计价模式')

  const { total, details } = computeLaundryTotal(rates, input)
  if (details.length === 0) throw new Error('订单内容为空')
  const discount = Math.min(Math.max(Number(input.discount ?? 0), 0), total)
  const finalTotal = total - discount
  if (finalTotal > MAX_ORDER_AMOUNT) throw new Error('订单金额超出上限')
  const paidAmount = Math.min(Math.max(Number(input.paidAmount ?? 0), 0), finalTotal)

  const customerPhone = input.customerPhone ? normalizePhone(input.customerPhone) : null
  const idempotencyKey = input.idempotencyKey?.trim() || null
  const tagCode = ''

  try {
    if (idempotencyKey) {
      const existing = await findIdempotentOrder(user.shopId, idempotencyKey)
      if (existing) return { orderNo: existing.orderNo, displayNo: existing.displayNo, tagCode: null }
    }

    const order = await prisma.$transaction(async (tx) => {
      await lockShopForUpdate(tx, user.shopId)
      const { orderNo, displayNo } = await nextOrderNumbers(tx, user.shopId, 'LD')

      // 生成 3 位标签码（L_TAG）：从 Shop.config.laundryTagSeq 自增，锁内读写防撞号
      const shopInTx = await tx.shop.findUnique({
        where: { id: user.shopId },
        select: { config: true },
      })
      const cfg = (shopInTx?.config ?? {}) as Record<string, unknown>
      const curSeq = Number(cfg.laundryTagSeq ?? 0)
      const nextSeq = Math.min(curSeq + 1, TAG_CODE_MAX)
      const code = `#${String(nextSeq).padStart(3, '0')}`
      await tx.shop.update({
        where: { id: user.shopId },
        data: { config: { ...cfg, laundryTagSeq: nextSeq } as Prisma.InputJsonValue },
      })

      return tx.order.create({
        data: {
          orderNo,
          displayNo,
          shopId: user.shopId,
          status: PROGRESS_STATUS[PROGRESS_SEQ[0]] as 'PENDING',
          items: details as Prisma.InputJsonValue,
          total,
          paidAmount,
          customerName: input.customerName?.trim() || null,
          customerPhone,
          note: input.note?.trim() || null,
          idempotencyKey,
          config: {
            laundryMode: input.mode,
            laundryStatus: PROGRESS_SEQ[0],
            tagCode: code,
            ticketId: crypto.randomUUID(),
            ...(input.mode === 'kg' ? { kg: Math.max(Number(input.kg ?? 0), 0) } : {}),
            ...(input.mode === 'item' ? { itemNames: details.map((d) => d.name) } : {}),
            ...(input.mode === 'shoe'
              ? {
                  shoeStyle: input.shoeStyle ?? null,
                  shoeAddonNames: (input.shoeAddons ?? []).map((n) => n),
                }
              : {}),
            // 收货照 / 护理类型 / 取送
            ...(input.photos?.length ? { photo: input.photos } : {}),
            ...(input.careType ? { careType: input.careType } : {}),
            ...(input.dispatchType ? { dispatchType: input.dispatchType } : {}),
            ...(input.address ? { address: input.address } : {}),
            ...(input.deliveryFee != null ? { deliveryFee: input.deliveryFee } : {}),
            ...(input.timeWindow ? { timeWindow: input.timeWindow } : {}),
            discount,
          },
        },
      })
    })

    revalidatePath('/[locale]/dashboard', 'page')
    return { orderNo: order.orderNo, displayNo: order.displayNo, tagCode }
  } catch (e) {
    if (idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await findIdempotentOrder(user.shopId, idempotencyKey)
      if (existing) return { orderNo: existing.orderNo, displayNo: existing.displayNo, tagCode: null }
    }
    console.error('laundry 开单失败:', e)
    throw e
  }
}

// —— 状态推进（待洗→洗涤中→质检→待取→结单）——
export async function advanceLaundryStatus(orderId: string, progress: LaundryProgress, qcNote?: string) {
  const user = await requireOwner()
  const order = assertShopOwned(
    user.shopId,
    await prisma.order.findUnique({ where: { id: orderId }, include: { shop: { select: { vertical: true } } } }),
  )
  if (order.shop.vertical !== 'LAUNDRY') throw new Error('非洗衣店订单')
  const cfg = (order.config as Record<string, unknown> | null) ?? {}
  const cur = ((cfg.laundryStatus as string) ?? PROGRESS_SEQ[0]) as LaundryProgress
  const nextIdx = PROGRESS_SEQ.indexOf(progress)
  const curIdx = PROGRESS_SEQ.indexOf(cur)
  if (nextIdx < 0) throw new Error('非法状态')
  if (curIdx >= nextIdx) throw new Error('状态不能回退')

  const upd: Prisma.OrderUpdateInput = {
    status: PROGRESS_STATUS[progress] as 'PENDING' | 'IN_PROGRESS' | 'READY' | 'COMPLETED',
    config: { ...cfg, laundryStatus: progress } as Prisma.InputJsonValue,
  }

  // 质检（qc）时记录备注（残留/损伤；若需再洗由 rewashLaundry 退回）
  if (progress === 'qc' && qcNote) {
    upd.config = { ...cfg, laundryStatus: 'qc', qcNote: qcNote.trim() } as Prisma.InputJsonValue
  }

  // 到「待取 Chờ lấy」触发催取提醒（LAUNDRY_READY，0 API 一键复制发 Zalo）
  if (progress === 'ready') {
    const dup = await prisma.reminder.findFirst({
      where: { shopId: user.shopId, orderId: order.id, templateKey: 'LAUNDRY_READY', status: 'PENDING' },
      select: { id: true },
    })
    if (!dup) {
      await prisma.reminder.create({
        data: {
          shopId: user.shopId,
          orderId: order.id,
          templateKey: 'LAUNDRY_READY',
          dueAt: new Date(),
          status: 'PENDING',
          payload: {
            displayNo: order.displayNo,
            tagCode: cfg.tagCode ?? null,
            customerPhone: order.customerPhone,
            customerName: order.customerName,
            total: Number(order.total),
          },
        },
      })
    }
  }
  // 结单：清该单待办（催取/逾期）
  if (progress === 'collected') {
    await prisma.reminder.updateMany({
      where: { orderId: order.id, templateKey: { in: ['LAUNDRY_READY', 'LAUNDRY_OVERDUE'] }, status: 'PENDING' },
      data: { status: 'DISMISSED' },
    })
  }

  await prisma.order.update({ where: { id: order.id }, data: upd })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— 质检未过 → 退回洗涤中（再洗）——
export async function rewashLaundry(orderId: string, reason?: string) {
  const user = await requireOwner()
  const order = assertShopOwned(
    user.shopId,
    await prisma.order.findUnique({ where: { id: orderId } }),
  )
  const cfg = (order.config as Record<string, unknown> | null) ?? {}
  if (cfg.laundryStatus !== 'qc') throw new Error('仅在质检后可再洗')
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: 'IN_PROGRESS',
      config: { ...cfg, laundryStatus: 'washing', qcNote: reason?.trim() || cfg.qcNote || null } as Prisma.InputJsonValue,
    },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— 交接凭证数据（老板端复制 + 生成 ticketId）——
export async function issueLaundryTicket(orderId: string) {
  const user = await requireOwner()
  const order = assertShopOwned(
    user.shopId,
    await prisma.order.findUnique({ where: { id: orderId } }),
  )
  const cfg = (order.config as Record<string, unknown> | null) ?? {}
  if (!cfg.ticketId) {
    await prisma.order.update({
      where: { id: order.id },
      data: { config: { ...cfg, ticketId: crypto.randomUUID() } as Prisma.InputJsonValue },
    })
  }
  return { ok: true }
}


export async function cancelLaundryOrder(orderId: string) {
  const user = await requireOwner()
  const order = assertShopOwned(
    user.shopId,
    await prisma.order.findUnique({ where: { id: orderId } }),
  )
  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'CANCELLED', config: { ...((order.config ?? {}) as Record<string, unknown>), laundryStatus: null } as Prisma.InputJsonValue },
  })
  await prisma.reminder.updateMany({
    where: { orderId: order.id, status: 'PENDING' },
    data: { status: 'DISMISSED' },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— 收款（实收）——
export async function settleLaundry(orderId: string, amount: number) {
  const user = await requireOwner()
  const order = assertShopOwned(
    user.shopId,
    await prisma.order.findUnique({ where: { id: orderId } }),
  )
  const paid = Math.min(Math.max(Number(amount ?? 0), 0), Number(order.total))
  await prisma.order.update({ where: { id: order.id }, data: { paidAmount: paid } })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— 欠款收回 ——
export async function markDebtPaid(orderId: string) {
  await settleLaundry(orderId, Number.MAX_SAFE_INTEGER)
}

// —— 设置（计价 + 收款信息）——
export async function saveLaundrySettings(input: {
  laundryRates: LaundryRates
  payment?: Record<string, unknown>
  deliveryFee?: number
  extraCategories?: { key: string; name: string; price: number; unit: string }[]
  careSurcharge?: number
}) {
  const user = await requireOwner()
  const shop = await prisma.shop.findUnique({ where: { id: user.shopId } })
  const cfg = (shop?.config ?? {}) as Record<string, unknown>
  await prisma.shop.update({
    where: { id: user.shopId },
    data: {
      config: {
        ...cfg,
        laundryRates: input.laundryRates,
        ...(input.payment ? { payment: input.payment } : {}),
        ...(input.deliveryFee != null ? { deliveryFee: input.deliveryFee } : {}),
        ...(input.extraCategories ? { extraCategories: input.extraCategories } : {}),
        ...(input.careSurcharge != null ? { careSurcharge: input.careSurcharge } : {}),
      } as Prisma.InputJsonValue,
    },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— 订单列表（30s 轮询）——
function serializeLaundryOrder(o: {
  id: string
  displayNo: string
  total: unknown
  paidAmount: unknown
  status: string
  customerName: string | null
  customerPhone: string | null
  note: string | null
  createdAt: Date
  config: Prisma.JsonValue | null
}): import('@/components/laundry/types').LaundryOrderPlain {
  const cfg = (o.config ?? {}) as Record<string, unknown>
  const mode = (cfg.laundryMode as LaundryMode) ?? 'kg'
  const overdueClass = (() => {
    if (cfg.laundryStatus !== 'ready') return 0
    const days = (Date.now() - o.createdAt.getTime()) / (24 * 60 * 60 * 1000)
    return days > OVERDUE_DAYS_2 ? 2 : days > OVERDUE_DAYS_1 ? 1 : 0
  })() as 0 | 1 | 2
  return {
    id: o.id,
    displayNo: o.displayNo,
    mode,
    tagCode: (cfg.tagCode as string) ?? null,
    kg: cfg.kg != null ? Number(cfg.kg) : null,
    itemNames: Array.isArray(cfg.itemNames) ? (cfg.itemNames as string[]) : [],
    shoeStyle: (cfg.shoeStyle as ShoeStyle) ?? null,
    shoeAddonNames: Array.isArray(cfg.shoeAddonNames) ? (cfg.shoeAddonNames as string[]) : [],
    status: o.status,
    laundryStatus: (cfg.laundryStatus as string) ?? '',
    total: String(Number(o.total)),
    paidAmount: String(Number(o.paidAmount)),
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    note: o.note,
    createdAt: o.createdAt.toISOString(),
    overdueClass,
    // P2 取送/护理/计件明细
    dispatchType: (cfg.dispatchType as string) ?? null,
    address: (cfg.address as string) ?? null,
    timeWindow: (cfg.timeWindow as string) ?? null,
    careType: (cfg.careType as string) ?? null,
    itemDetail: Array.isArray(cfg.itemDetail) ? (cfg.itemDetail as { name: string; count: number; mark?: string }[]) : [],
    qcNote: (cfg.qcNote as string) ?? null,
    ticketId: (cfg.ticketId as string) ?? null,
    claim: Array.isArray(cfg.claim) ? (cfg.claim as { type: string; note?: string; resolution: string; amount: number }[]) : [],
  }
}

export async function getLaundryOrders() {
  const user = await requireOwner()
  const orders = await prisma.order.findMany({
    where: { shopId: user.shopId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return orders.map(serializeLaundryOrder)
}

// —— 今日概览（今日公斤 / 今日营收 / 待取 / 欠款）——
export async function getLaundryOverview() {
  const user = await requireOwner()
  const start = vietnamTodayStartUtc()
  const today = await prisma.order.findMany({
    where: { shopId: user.shopId, createdAt: { gte: start }, status: { not: 'CANCELLED' } },
  })
  let todayKg = 0
  let todayRevenue = 0
  for (const o of today) {
    const cfg = (o.config ?? {}) as Record<string, unknown>
    if (cfg.laundryMode === 'kg') todayKg += Number(cfg.kg ?? 0)
    todayRevenue += Number(o.paidAmount)
  }
  const waiting = today.filter((o) => (o.config as Record<string, unknown>)?.laundryStatus === 'ready').length
  const allDebt = await prisma.order.aggregate({
    where: { shopId: user.shopId, status: { not: 'CANCELLED' } },
    _sum: { total: true, paidAmount: true },
  })
  const debtTotal = Number(allDebt._sum.total ?? 0) - Number(allDebt._sum.paidAmount ?? 0)
  return { todayKg, todayRevenue: String(todayRevenue), waitingPickup: waiting, debtTotal: String(Math.max(debtTotal, 0)) }
}

// —— 待办催取提醒（LAUNDRY_READY + 逾期分级）——
export async function getLaundryReminders() {
  const user = await requireOwner()
  const reminders = await prisma.reminder.findMany({
    where: { shopId: user.shopId, templateKey: 'LAUNDRY_READY', status: 'PENDING', dueAt: { lte: new Date() } },
    include: { order: { select: { createdAt: true, total: true, config: true, customerPhone: true } } },
    orderBy: { dueAt: 'asc' },
  })
  return reminders.map((r) => {
    const days = r.order ? (Date.now() - r.order.createdAt.getTime()) / (24 * 60 * 60 * 1000) : 0
    const overdueClass = (days > OVERDUE_DAYS_2 ? 2 : days > OVERDUE_DAYS_1 ? 1 : 0) as 0 | 1 | 2
    const cfg = (r.order?.config ?? {}) as Record<string, unknown>
    const tagCode = ((r.payload as { tagCode?: string } | null)?.tagCode ?? (cfg.tagCode as string | undefined)) ?? null
    return {
      id: r.id,
      overdueClass,
      displayNo: (r.payload as { displayNo?: string } | null)?.displayNo ?? null,
      tagCode,
      customerPhone: r.order?.customerPhone ?? null,
      total: String(Number(r.order?.total ?? 0)),
    }
  })
}

export async function markLaundryReminderSent(reminderId: string) {
  const user = await requireOwner()
  const rm = await prisma.reminder.findFirst({ where: { id: reminderId, shopId: user.shopId } })
  if (!rm) throw new Error('提醒不存在')
  await prisma.reminder.update({ where: { id: reminderId }, data: { status: 'SENT' } })
  revalidatePath('/[locale]/dashboard', 'page')
}

export async function dismissLaundryReminder(reminderId: string) {
  const user = await requireOwner()
  const rm = await prisma.reminder.findFirst({ where: { id: reminderId, shopId: user.shopId } })
  if (!rm) throw new Error('提醒不存在')
  await prisma.reminder.update({ where: { id: reminderId }, data: { status: 'DISMISSED' } })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— P3 会员：储值/次卡（Customer.balance + CustomerCard，跨垂直可复用）——
// 店主按手机号找/建顾客 → 充值/开卡 → 结账可扣储值或扣次卡。
export async function getLaundryCustomer(phone: string) {
  const user = await requireOwner()
  const p = normalizePhone(phone)
  if (!p) throw new Error('手机号不能为空')
  return prisma.customer.findUnique({
    where: { phone: p },
    include: { cards: { where: { shopId: user.shopId }, orderBy: { createdAt: 'desc' } } },
  })
}

export async function findOrCreateLaundryCustomer(phone: string, name?: string) {
  const user = await requireOwner()
  const p = normalizePhone(phone)
  if (!p) throw new Error('手机号不能为空')
  const found = await prisma.customer.findUnique({ where: { phone: p } })
  if (found) return found
  return prisma.customer.create({ data: { phone: p, name: name?.trim() || null, provider: 'password' } })
}

export async function topUpLaundryBalance(customerId: string, amount: number) {
  const user = await requireOwner()
  const c = await prisma.customer.findFirst({ where: { id: customerId }, select: { id: true, balance: true } })
  if (!c) throw new Error('顾客不存在')
  const amt = Math.max(Number(amount ?? 0), 0)
  await prisma.customer.update({ where: { id: c.id }, data: { balance: Number(c.balance) + amt } })
  revalidatePath('/[locale]/dashboard', 'page')
}

export async function createLaundryCard(input: { customerId: string; type: 'credit' | 'count'; name?: string; count?: number; amount?: number }) {
  const user = await requireOwner()
  const c = await prisma.customer.findFirst({ where: { id: input.customerId } })
  if (!c) throw new Error('顾客不存在')
  const card = await prisma.customerCard.create({
    data: {
      customerId: c.id,
      shopId: user.shopId,
      type: input.type,
      name: input.name?.trim() || null,
      remainingCount: input.type === 'count' ? Math.max(Number(input.count ?? 0), 0) : null,
      balance: input.type === 'credit' ? Math.max(Number(input.amount ?? 0), 0) : 0,
    },
  })
  revalidatePath('/[locale]/dashboard', 'page')
  return card
}

// 结账：从储值余额扣（充值余额扣到不足则拒）
export async function payLaundryByBalance(orderId: string, customerId: string, amount: number) {
  const user = await requireOwner()
  const order = assertShopOwned(user.shopId, await prisma.order.findUnique({ where: { id: orderId } }))
  const c = await prisma.customer.findFirst({ where: { id: customerId }, select: { id: true, balance: true } })
  if (!c) throw new Error('顾客不存在')
  const amt = Math.min(Math.max(Number(amount ?? 0), 0), Number(order.total))
  if (Number(c.balance) < amt) throw new Error('余额不足')
  await prisma.$transaction([
    prisma.customer.update({ where: { id: c.id }, data: { balance: Number(c.balance) - amt } }),
    prisma.order.update({ where: { id: order.id }, data: { paidAmount: amt } }),
  ])
  revalidatePath('/[locale]/dashboard', 'page')
}

// 结账：扣次卡（卡剩余次数减 1，结清整单）
export async function payLaundryByCard(orderId: string, cardId: string) {
  const user = await requireOwner()
  const order = assertShopOwned(user.shopId, await prisma.order.findUnique({ where: { id: orderId } }))
  const card = await prisma.customerCard.findFirst({ where: { id: cardId, shopId: user.shopId } })
  if (!card || card.type !== 'count') throw new Error('次卡不存在')
  const rem = card.remainingCount ?? 0
  if (rem <= 0) throw new Error('次卡次数不足')
  await prisma.$transaction([
    prisma.customerCard.update({ where: { id: card.id }, data: { remainingCount: rem - 1 } }),
    prisma.order.update({ where: { id: order.id }, data: { paidAmount: order.total } }),
  ])
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— P3 理赔单（记录损坏/丢失 → 处理方式/金额；存 Order.config.claim[]，拍照已存 photo）——
export async function addLaundryClaim(orderId: string, input: { type: 'damage' | 'lost'; note?: string; resolution: 'refund' | 'partial' | 'credit'; amount: number }) {
  const user = await requireOwner()
  const order = assertShopOwned(user.shopId, await prisma.order.findUnique({ where: { id: orderId } }))
  const cfg = (order.config as Record<string, unknown> | null) ?? {}
  const claim = Array.isArray(cfg.claim) ? (cfg.claim as Record<string, unknown>[]) : []
  await prisma.order.update({
    where: { id: order.id },
    data: {
      config: {
        ...cfg,
        claim: [...claim, { type: input.type, note: input.note?.trim() ?? null, resolution: input.resolution, amount: Math.max(Number(input.amount ?? 0), 0) }],
      } as Prisma.InputJsonValue,
    },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— P3 顾客侧：登录顾客看本店洗衣订单 + 储值 + 卡（requireCustomer 已守卫）——
export async function getMyLaundry(slug: string, vertical: 'LAUNDRY', city: string) {
  const user = await requireCustomer(slug, vertical, city as never)
  const cid = user.customerId
  const customer = await prisma.customer.findUnique({
    where: { id: cid },
    select: { id: true, phone: true, name: true, balance: true, cards: { where: { shopId: (await prisma.shop.findUnique({ where: { slug }, select: { id: true } }))?.id ?? '' } } },
  })
  const shop = await prisma.shop.findUnique({ where: { slug }, select: { id: true } })
  const orders = await prisma.order.findMany({
    where: { shopId: shop?.id, customerId: cid },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return {
    customer: customer
      ? {
          id: customer.id, phone: customer.phone, name: customer.name,
          balance: String(Number(customer.balance)),
          cards: customer.cards.map((c) => ({ id: c.id, type: c.type, name: c.name, remainingCount: c.remainingCount, balance: String(Number(c.balance)) })),
        }
      : null,
    orders: orders.map((o) => {
      const cfg = (o.config as Record<string, unknown> | null) ?? {}
      return {
        id: o.id, displayNo: o.displayNo, status: o.status, laundryStatus: (cfg.laundryStatus as string) ?? '', tagCode: (cfg.tagCode as string) ?? null, total: String(Number(o.total)), paidAmount: String(Number(o.paidAmount)), createdAt: o.createdAt.toISOString(),
      }
    }),
  }
}

// —— 客户侧：匿名查单（手机号 + 取件码 → 本店该单进度/金额；公开，不需登录）——
export async function lookupLaundryOrder(slug: string, phone: string, tagCode: string) {
  const shop = await prisma.shop.findUnique({ where: { slug }, select: { id: true } })
  if (!shop) throw new Error('店铺不存在')
  const t = tagCode.trim()
  const order = await prisma.order.findFirst({
    where: {
      shopId: shop.id,
      customerPhone: phone.trim(),
      config: { path: ['tagCode'], equals: t },
      status: { not: 'CANCELLED' },
    },
    orderBy: { orderNo: 'desc' },
  })
  if (!order) throw new Error('未找到该订单')
  const cfg = (order.config as Record<string, unknown> | null) ?? {}
  return {
    displayNo: order.displayNo,
    tagCode: (cfg.tagCode as string) ?? t,
    laundryStatus: (cfg.laundryStatus as string) ?? '',
    total: String(Number(order.total)),
    paidAmount: String(Number(order.paidAmount)),
    createdAt: order.createdAt.toISOString(),
  }
}

// —— 老板侧客户台账（客户管理）：本店顾客列表 + 余额 + 卡 + 消费聚合 ——
export async function getLaundryCustomers() {
  const user = await requireOwner()
  const sid = user.shopId
  // 本店有订单/卡/余额的顾客（按 customerPhone 或 customerId）；工厂无 Customer 行的也归并到 phone
  const orders = await prisma.order.groupBy({
    by: ['customerPhone'],
    where: { shopId: sid, customerPhone: { not: null } },
    _count: { id: true },
    _sum: { total: true, paidAmount: true },
    orderBy: { customerPhone: 'asc' },
  })
  const customers = await prisma.customer.findMany({
    where: { orders: { some: { shopId: sid } } },
    include: { cards: { where: { shopId: sid } } },
  })
  // phone → customer 行
  const byPhone = new Map(customers.map((c) => [c.phone, c]))
  const rows = orders
    .filter((o) => o.customerPhone)
    .map((o) => {
      const c = byPhone.get(o.customerPhone!) as (typeof customers)[number] | undefined
      return {
        phone: o.customerPhone!,
        name: c?.name ?? null,
        balance: String(Number(c?.balance ?? 0)),
        orderCount: o._count.id,
        spend: String(Number(o._sum.total ?? 0)),
        paid: String(Number(o._sum.paidAmount ?? 0)),
        cards: (c?.cards ?? []).map((k) => ({ id: k.id, type: k.type, name: k.name, remainingCount: k.remainingCount, balance: String(Number(k.balance)) })),
      }
    })
  return rows
}

// —— 顾客自助复购：同店/同顾客/同项目(快照) → 新建一张"待洗"单 ——
export async function reorderLaundry(orderId: string) {
  const session = await auth()
  const cid = session?.user?.customerId
  if (!cid) throw new Error('请先登录')
  const src = await prisma.order.findFirst({ where: { id: orderId, customerId: cid } })
  if (!src) throw new Error('订单不存在')
  const srcCfg = (src.config as Record<string, unknown> | null) ?? {}
  const order = await prisma.$transaction(async (tx) => {
    await lockShopForUpdate(tx, src.shopId)
    const { orderNo, displayNo } = await nextOrderNumbers(tx, src.shopId, 'LD')
    const shopInTx = await tx.shop.findUnique({ where: { id: src.shopId }, select: { config: true } })
    const cfg = (shopInTx?.config ?? {}) as Record<string, unknown>
    const curSeq = Number(cfg.laundryTagSeq ?? 0)
    const nextSeq = Math.min(curSeq + 1, TAG_CODE_MAX)
    const code = `#${String(nextSeq).padStart(3, '0')}`
    await tx.shop.update({ where: { id: src.shopId }, data: { config: { ...cfg, laundryTagSeq: nextSeq } as Prisma.InputJsonValue } })
    return tx.order.create({
      data: {
        orderNo, displayNo, shopId: src.shopId, status: 'PENDING',
        items: src.items as Prisma.InputJsonValue, total: src.total, paidAmount: 0,
        customerId: cid, customerPhone: src.customerPhone, customerName: src.customerName, note: src.note,
        config: { ...srcCfg, laundryStatus: 'washing_pending', tagCode: code, ticketId: crypto.randomUUID() } as Prisma.InputJsonValue,
      },
    })
  })
  revalidatePath('/[locale]/dashboard', 'page')
  return { displayNo: order.displayNo, tagCode: (order.config as { tagCode?: string } | null)?.tagCode ?? null }
}
