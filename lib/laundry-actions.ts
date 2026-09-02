'use server'
// LAUNDRY 老板端 server actions：三模式快速开单 + 状态推进 + 收款 + 设置 + 提醒 + 今日统计
// 全部 requireOwner + assertShopOwned（租户隔离）；LAUNDRY 专属动作再校验 vertical（laundryStatus 只作用于 laundry 店订单）。
// 计费复用 MOTO 模式：COUNT 走 order-shared 公共取号；计价从 Shop.config.laundryRates 服务端重算（不信任客户端传价）。
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireOwner } from '@/lib/dal'
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
// 细分状态流（唯一权威）：待洗 → 洗涤中 → 待取（Chờ lấy）→ 已结单
const PROGRESS_SEQ = ['washing_pending', 'washing', 'ready', 'collected'] as const
const PROGRESS_STATUS: Record<string, string> = {
  washing_pending: 'PENDING',
  washing: 'IN_PROGRESS',
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
            ...(input.mode === 'kg' ? { kg: Math.max(Number(input.kg ?? 0), 0) } : {}),
            ...(input.mode === 'item' ? { itemNames: details.map((d) => d.name) } : {}),
            ...(input.mode === 'shoe'
              ? {
                  shoeStyle: input.shoeStyle ?? null,
                  shoeAddonNames: (input.shoeAddons ?? []).map((n) => n),
                }
              : {}),
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

// —— 状态推进（待洗→洗涤中→待取→结单）——
export async function advanceLaundryStatus(orderId: string, progress: LaundryProgress) {
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

// —— 取消单（公共状态 CANCELLED，laundryStatus 置空；凭证/列表不展示）——
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
}) {
  const user = await requireOwner()
  const shop = await prisma.shop.findUnique({ where: { id: user.shopId } })
  const cfg = (shop?.config ?? {}) as Record<string, unknown>
  await prisma.shop.update({
    where: { id: user.shopId },
    data: { config: { ...cfg, laundryRates: input.laundryRates, ...(input.payment ? { payment: input.payment } : {}) } as Prisma.InputJsonValue },
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
