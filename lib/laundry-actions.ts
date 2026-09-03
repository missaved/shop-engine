'use server'
// LAUNDRY 老板端 server actions：三模式快速开单 + 状态推进 + 收款 + 设置 + 提醒 + 今日统计
// 全部 requireOwner + assertShopOwned（租户隔离）；LAUNDRY 专属动作再校验 vertical（laundryStatus 只作用于 laundry 店订单）。
// 计费复用 MOTO 模式：COUNT 走 order-shared 公共取号；计价从 Shop.config.laundryRates 服务端重算（不信任客户端传价）。
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireOwner, requireCustomer } from '@/lib/dal'
import { auth } from '@/auth'
import { isShopExpired } from '@/lib/billing'
import { assertShopOwned } from '@/lib/tenant'
import { normalizePhone, PHONE_RE } from '@/lib/phone'
import { isHitLimited, recordHit, type HitOpts } from '@/lib/rate-limit'
import { vietnamTodayStartUtc } from '@/lib/dashboard-orders'
import {
  MAX_ORDER_AMOUNT,
  lockShopForUpdate,
  lockOrderForUpdate,
  nextOrderNumbers,
  findIdempotentOrder,
} from '@/lib/order-shared'
import type { LaundryMode, LaundryRates, ShoeStyle } from '@/components/laundry/types'

// —— 常量 ——
// 细分状态流（唯一权威，含质检 QC/配送）：
//   submitted(顾客已提交待确认) → washing_pending(老板交接确认出具凭证) → washing → qc → ready → collected
const PROGRESS_SEQ = ['submitted', 'washing_pending', 'washing', 'qc', 'ready', 'collected'] as const
const PROGRESS_STATUS: Record<string, string> = {
  submitted: 'PENDING',
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

// 顾客匿名自助下单限流档（审计四轮 I/L）：游客（无登录会话）按 IP 每 60s 最多 10 次提交；宽松档——
// 正常自助一单一次，10 次/60s 对单 IP 已极宽松、只挡脚本连刷；有登录会话不入此桶（有账号成本，非匿名刷单面）。
// L（审计四轮）：改用语义中性的动作频率计数原语（isHitLimited/recordHit，非失败限流），成功提交只作普通窗口计数。
const ANON_SUBMIT_OPTS: HitOpts = { max: 10, windowMs: 60 * 1000 }
// 待取催取档位：LAUNDRY_READY（ready 当下一档，advanceLaundryStatus 事件创建）/
//   LAUNDRY_OVERDUE_1（滞留 >3 天）/ LAUNDRY_OVERDUE_2（滞留 >7 天）。逾期档由 escalateLaundryOverdue 惰性生成。
// index = 档位 level（0/1/2），供收敛低档与 overdueClass 映射共用。
const READY_REMINDER_KEYS = ['LAUNDRY_READY', 'LAUNDRY_OVERDUE_1', 'LAUNDRY_OVERDUE_2'] as const
const REMINDER_OVERDUE_CLASS: Record<string, 0 | 1 | 2> = {
  LAUNDRY_READY: 0,
  LAUNDRY_OVERDUE_1: 1,
  LAUNDRY_OVERDUE_2: 2,
}

// 逾期滞留毫秒：基准 readyAt（订单到「待取」的时刻，advanceLaundryStatus ready 时写入）；
// 老数据（修复前就绪的单）无 readyAt → 回退 createdAt 兜底。E 项基准修正的唯一起算点。
function readyDaysMs(cfg: Record<string, unknown>, createdAt: Date): number {
  const base = cfg.readyAt ? new Date(cfg.readyAt as string).getTime() : createdAt.getTime()
  return Date.now() - base
}

// 标签码 3 位
const TAG_CODE_MAX = 999

function readRates(shop: { config?: Prisma.JsonValue | null } | null): LaundryRates | null {
  const cfg = (shop?.config ?? {}) as Record<string, unknown>
  return (cfg.laundryRates as LaundryRates | undefined) ?? null
}

// 配送费（审计五轮 M 定案：仅「deliver 送到家」收取；in_store/pickup 免费；金额 = Shop.config.deliveryFee，>0 才收）
// 服务端权威：不信任客户端传价，一律按店配置 + dispatchType 自算。独立存 config.deliveryFee，不进 items 明细（防交接 override 覆盖丢失）。
function deliveryFeeOf(shopCfg: Record<string, unknown> | null | undefined, dispatchType?: string): number {
  if (dispatchType !== 'deliver') return 0
  const fee = Number(shopCfg?.deliveryFee ?? 0)
  return Number.isFinite(fee) && fee > 0 ? Math.round(fee) : 0
}

// 按模式重算 total（服务端权威：公斤=kg×单价 / 按件=Σ单价×件数 / 洗鞋=款式底价+Σ增值）
function computeLaundryTotal(
  rates: LaundryRates,
  input: {
    mode: LaundryMode
    kg?: number
    itemSelections?: { name: string; qty: number }[]
    itemDetail?: { name: string; count: number; mark?: string }[]
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
    // 自助下单传 itemDetail（按件点选），老板开单传 itemSelections；两者都计价，取并集
    const sel = (input.itemSelections ?? []).map((s) => ({ name: s.name, qty: s.qty }))
    const detail = (input.itemDetail ?? []).map((s) => ({ name: s.name, qty: s.count }))
    const merged = [...sel, ...detail]
    const details = merged
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
  const deliveryFee = deliveryFeeOf((shop?.config ?? {}) as Record<string, unknown>, input.dispatchType) // 审计五轮 M：deliver 送到家才收，服务端按店配费权威计算
  const discount = Math.min(Math.max(Number(input.discount ?? 0), 0), total) // 折扣只作用于洗衣费，配送费不打折
  const finalTotal = total - discount + deliveryFee
  if (finalTotal > MAX_ORDER_AMOUNT) throw new Error('订单金额超出上限')
  const paidAmount = Math.min(Math.max(Number(input.paidAmount ?? 0), 0), finalTotal)

  const customerPhone = input.customerPhone ? normalizePhone(input.customerPhone) : null
  const idempotencyKey = input.idempotencyKey?.trim() || null

  try {
    if (idempotencyKey) {
      const existing = await findIdempotentOrder(user.shopId, idempotencyKey)
      if (existing)
        return {
          orderNo: existing.orderNo,
          displayNo: existing.displayNo,
          tagCode: ((existing.config as { tagCode?: string } | null)?.tagCode) ?? null,
        }
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
          // 老板开单（Tạo đơn）跳过顾客「submitted → 交接确认」：直接进入 washing_pending「待开始洗」，
          // 老板下一步即「Bắt đầu giặt」；交接确认仅保留给顾客自助下单。
          status: PROGRESS_STATUS['washing_pending'] as 'PENDING',
          items: details as Prisma.InputJsonValue,
          total: total + deliveryFee, // 订单金额含配送费（审计五轮 M：进 DB → 收款/欠款/营收自动含）
          paidAmount,
          customerName: input.customerName?.trim() || null,
          customerPhone,
          note: input.note?.trim() || null,
          idempotencyKey,
          config: {
            laundryMode: input.mode,
            laundryStatus: 'washing_pending',
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
            ...(deliveryFee > 0 ? { deliveryFee } : {}), // 服务端权威配送费（审计五轮 M：不再信客户端传 input.deliveryFee）
            ...(input.timeWindow ? { timeWindow: input.timeWindow } : {}),
            discount,
          },
        },
      })
    })

    revalidatePath('/[locale]/dashboard', 'page')
    return {
      orderNo: order.orderNo,
      displayNo: order.displayNo,
      tagCode: ((order.config as { tagCode?: string } | null)?.tagCode) ?? null,
    }
  } catch (e) {
    if (idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await findIdempotentOrder(user.shopId, idempotencyKey)
      if (existing)
        return {
          orderNo: existing.orderNo,
          displayNo: existing.displayNo,
          tagCode: ((existing.config as { tagCode?: string } | null)?.tagCode) ?? null,
        }
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
  // 强制逐步（审计二轮 B）：仅允许相邻推进，防跳步漏 qc 备注 / readyAt / LAUNDRY_READY 提醒 / collected 清理
  if (curIdx >= nextIdx) throw new Error('状态不能回退')
  if (curIdx + 1 !== nextIdx) throw new Error('状态需逐步推进')

  const upd: Prisma.OrderUpdateInput = {
    status: PROGRESS_STATUS[progress] as 'PENDING' | 'IN_PROGRESS' | 'READY' | 'COMPLETED',
    // 到「待取」落 readyAt（滞留/逾期的唯一基准；老数据缺此键则回退 createdAt 兜底）
    config:
      progress === 'ready'
        ? ({ ...cfg, laundryStatus: 'ready', readyAt: new Date().toISOString() } as Prisma.InputJsonValue)
        : ({ ...cfg, laundryStatus: progress } as Prisma.InputJsonValue),
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
  // 结单：清该单一切 PENDING 待办（ready + 逾期各档；按 orderId 全清，覆盖面大于按 key 白名单，
  // 语义=取走即停所有催取；同单 reminder 皆属该单，无跨垂直误伤）
  if (progress === 'collected') {
    await prisma.reminder.updateMany({
      where: { orderId: order.id, status: 'PENDING' },
      data: { status: 'DISMISSED' },
    })
  }

  await prisma.order.update({ where: { id: order.id }, data: upd })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— 质检未过 → 退回洗涤中（再洗）——
export async function rewashLaundry(orderId: string, reason?: string) {
  const user = await requireOwner()
  const order = await assertLaundryOrder(user.shopId, orderId)
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
  const order = await assertLaundryOrder(user.shopId, orderId)
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
  const order = await assertLaundryOrder(user.shopId, orderId)
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

// 洗衣专属动作垂直守卫（审计二轮 C，对齐 moto assertMotoShop）：settleLaundry/markDebtPaid 原先只有
// assertShopOwned（防跨店不防跨垂直），可误作用于非 LAUNDRY 单；advanceLaundryStatus 等早内联此守卫
async function assertLaundryOrder(shopId: string, orderId: string) {
  const order = assertShopOwned(
    shopId,
    await prisma.order.findUnique({ where: { id: orderId }, include: { shop: { select: { vertical: true } } } }),
  )
  if (order.shop.vertical !== 'LAUNDRY') throw new Error('非洗衣店订单')
  return order
}

// —— 收款（现金实收）——
// F（审计三轮）：实收按「本次收额累加」而非覆盖（UI 现金框默认填剩余，支持现金先部分→再收/储值补足），
// clamp 到 total 防超收；E：interactive tx 锁订单行 + 事务内重读，防同单并发丢累加
export async function settleLaundry(orderId: string, amount: number) {
  const user = await requireOwner()
  await assertLaundryOrder(user.shopId, orderId) // D 守卫（跨垂直拒绝）
  const amt = Math.max(Number(amount ?? 0), 0)
  await prisma.$transaction(async (tx) => {
    await lockOrderForUpdate(tx, orderId)
    const o = await tx.order.findUnique({ where: { id: orderId }, select: { paidAmount: true, total: true } })
    const paid = Math.min(Number(o?.paidAmount ?? 0) + amt, Number(o?.total ?? 0))
    await tx.order.update({ where: { id: orderId }, data: { paidAmount: paid } })
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— 欠款收回 ——
// 去 MAX_SAFE_INTEGER 哨兵（审计二轮 C）：直接置 paidAmount=total，语义直白，不再借 settleLaundry 的 clamp 拐弯
export async function markDebtPaid(orderId: string) {
  const user = await requireOwner()
  const order = await assertLaundryOrder(user.shopId, orderId)
  await prisma.order.update({ where: { id: order.id }, data: { paidAmount: Number(order.total) } })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— 设置（计价 + 收款信息）——
export async function saveLaundrySettings(input: {
  laundryRates: LaundryRates
  payment?: Record<string, unknown>
  deliveryFee?: number
  extraCategories?: { key: string; name: string; price: number; unit: string }[]
  careSurcharge?: number
  openHours?: string
  description?: string
  descriptionZh?: string
  descriptionEn?: string
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
        ...(input.openHours != null ? { openHours: input.openHours } : {}),
        ...(input.description != null ? { description: input.description } : {}),
        ...(input.descriptionZh != null ? { descriptionZh: input.descriptionZh } : {}),
        ...(input.descriptionEn != null ? { descriptionEn: input.descriptionEn } : {}),
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
    // E 项修正：滞留天数以 readyAt（ready 时刻）为基准，不再从 createdAt（含洗涤耗时）起算
    const days = readyDaysMs(cfg, o.createdAt) / (24 * 60 * 60 * 1000)
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

// —— 营业收入多档（今天/3天/7天/30天，营收同口径：排除取消 + paidAmount，业务日滚动）——
export async function getLaundryRevenue() {
  const user = await requireOwner()
  const todayStart = vietnamTodayStartUtc()
  const dayMs = 24 * 60 * 60 * 1000
  const orders = await prisma.order.findMany({
    where: { shopId: user.shopId, status: { not: 'CANCELLED' } },
    select: { paidAmount: true, createdAt: true },
  })
  const inRange = (d: number) => orders.filter((o) => o.createdAt >= new Date(todayStart.getTime() - (d - 1) * dayMs))
  const rev = (arr: typeof orders) => arr.reduce((s, o) => s + Number(o.paidAmount), 0)
  return {
    todayRevenue: String(rev(inRange(1))), count1: inRange(1).length,
    revenue3d: String(rev(inRange(3))), count3: inRange(3).length,
    revenue7d: String(rev(inRange(7))), count7: inRange(7).length,
    revenue30d: String(rev(inRange(30))), count30: inRange(30).length,
  }
}

// —— 待办催取提醒（LAUNDRY_READY + 逾期档位 LAUNDRY_OVERDUE_1/2）——
// B 项修正：overdueClass 由档位 key 决定（READY→0 / OVERDUE_1→1 / OVERDUE_2→2），不再读时按 createdAt 临时算；
// 读取前先 escalateLaundryOverdue 惰性升级逾期档（dashboard 30s 轮询自然驱动，无定时任务）。
export async function getLaundryReminders() {
  const user = await requireOwner()
  await escalateLaundryOverdue(user.shopId)
  const reminders = await prisma.reminder.findMany({
    where: { shopId: user.shopId, templateKey: { in: [...READY_REMINDER_KEYS] }, status: 'PENDING', dueAt: { lte: new Date() } },
    include: { order: { select: { total: true, config: true, customerPhone: true } } },
    orderBy: { dueAt: 'asc' },
  })
  return reminders.map((r) => {
    const cfg = (r.order?.config ?? {}) as Record<string, unknown>
    const tagCode = ((r.payload as { tagCode?: string } | null)?.tagCode ?? (cfg.tagCode as string | undefined)) ?? null
    return {
      id: r.id,
      overdueClass: REMINDER_OVERDUE_CLASS[r.templateKey] ?? 0,
      displayNo: (r.payload as { displayNo?: string } | null)?.displayNo ?? null,
      tagCode,
      customerPhone: r.order?.customerPhone ?? null,
      total: String(Number(r.order?.total ?? 0)),
    }
  })
}

// 逾期档位惰性升级（B 项触发点；读时驱动，副作用落在 30s 轮询上，单实例语义正确）：
// 扫本店仍「待取 ready」未取走的单 → 按 readyAt 滞留天数建对应逾期档提醒（>3 天 → OVERDUE_1，>7 天 → OVERDUE_2）；
// 每档只催一次（已存在 PENDING/SENT/DISMISSED 均不再建）；高档生成时把同单低档 PENDING 置 SENT（收敛，同单最多一条待办）。
async function escalateLaundryOverdue(shopId: string): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { shopId, status: 'READY' }, // PROGRESS_STATUS.ready = 'READY'
    select: { id: true, displayNo: true, customerPhone: true, customerName: true, total: true, createdAt: true, config: true },
  })
  for (const o of orders) {
    const cfg = (o.config ?? {}) as Record<string, unknown>
    if (cfg.laundryStatus !== 'ready') continue // 防御：status=READY 但细分状态非 ready
    const level = (() => {
      const days = readyDaysMs(cfg, o.createdAt) / (24 * 60 * 60 * 1000)
      if (days > OVERDUE_DAYS_2) return 2
      if (days > OVERDUE_DAYS_1) return 1
      return 0
    })()
    if (level === 0) continue // ready 当下档（LAUNDRY_READY）由 advanceLaundryStatus 事件创建，此处只补逾期档
    const key = READY_REMINDER_KEYS[level]
    const dup = await prisma.reminder.findFirst({
      where: { shopId, orderId: o.id, templateKey: key },
      select: { id: true },
    })
    if (dup) continue // 该档已有记录（PENDING 在办 / SENT 已催 / DISMISSED 已忽略）→ 每档一次
    const lowerKeys = READY_REMINDER_KEYS.slice(0, level)
    if (lowerKeys.length > 0) {
      // 收敛低档：本单低档位仍 PENDING 的待办置 SENT（旧档作废），保证待办不出现同单双卡
      await prisma.reminder.updateMany({
        where: { shopId, orderId: o.id, templateKey: { in: [...lowerKeys] }, status: 'PENDING' },
        data: { status: 'SENT' },
      })
    }
    await prisma.reminder.create({
      data: {
        shopId,
        orderId: o.id,
        templateKey: key,
        dueAt: new Date(),
        status: 'PENDING',
        payload: {
          displayNo: o.displayNo,
          tagCode: cfg.tagCode ?? null,
          customerPhone: o.customerPhone,
          customerName: o.customerName,
          total: Number(o.total),
        },
      },
    })
  }
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

// 审计六轮 O 定案：砍 credit 储值卡开卡——credit 卡可开不可用（结账 payLaundryByCard 只认 count）、且与 Customer.balance 钱包
//（topUpLaundryBalance 充值 → payLaundryByBalance 结账扣，已闭环）重复、收的钱锁死。开卡仅支持次卡 count，储值统一走充值余额。
// 已开的 credit 历史卡仍保留展示（其余组件 type!=='count' 分支不受影响），只是不再能新开。
export async function createLaundryCard(input: { customerId: string; name?: string; count: number }) {
  const user = await requireOwner()
  const c = await prisma.customer.findFirst({ where: { id: input.customerId } })
  if (!c) throw new Error('顾客不存在')
  const count = Math.max(Number(input.count ?? 0), 0)
  if (count <= 0) throw new Error('开卡次数必须大于 0')
  const card = await prisma.customerCard.create({
    data: {
      customerId: c.id,
      shopId: user.shopId,
      type: 'count',
      name: input.name?.trim() || null,
      remainingCount: count,
      balance: 0,
    },
  })
  revalidatePath('/[locale]/dashboard', 'page')
  return card
}

// 结账：从储值余额扣（充值余额扣到不足则拒）。paid 累加不覆盖（F，同 settleLaundry：支持现金先部分→储值补足）
// D 守卫：跨垂直拒绝；E：interactive tx 先锁 Customer 余额行再锁 Order 行、事务内重读后扣——
// 防并发超扣（两请求同读余额充足各扣一次）与同单并发丢累加
export async function payLaundryByBalance(orderId: string, customerId: string, amount: number) {
  const user = await requireOwner()
  await assertLaundryOrder(user.shopId, orderId)
  const amt = Math.max(Number(amount ?? 0), 0)
  if (amt <= 0) throw new Error('金额必须大于 0')
  await prisma.$transaction(async (tx) => {
    // E：先锁顾客余额行（串行化同顾客并发扣款）
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true, balance: true } })
    if (!c) throw new Error('顾客不存在')
    if (Number(c.balance) < amt) throw new Error('余额不足')
    // E：锁订单行 + 事务内重读 paid/total（同单并发不丢累加）
    await lockOrderForUpdate(tx, orderId)
    const o = await tx.order.findUnique({ where: { id: orderId }, select: { paidAmount: true, total: true } })
    const paid = Math.min(Number(o?.paidAmount ?? 0) + amt, Number(o?.total ?? 0))
    await tx.customer.update({ where: { id: customerId }, data: { balance: Number(c.balance) - amt } })
    await tx.order.update({ where: { id: orderId }, data: { paidAmount: paid } })
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// 结账：扣次卡（卡剩余次数减 1，结清整单 —— F 语义：次卡抵整单，paid 置 total 与累加结果等价）
// D 守卫：跨垂直拒绝；E：interactive tx 先锁 CustomerCard 行再锁 Order 行、事务内重读再扣——
// 防并发同卡超扣（两张单并发刷同一张剩 1 次的卡，各减 1 次）与同单竞态
export async function payLaundryByCard(orderId: string, cardId: string) {
  const user = await requireOwner()
  await assertLaundryOrder(user.shopId, orderId)
  const card = await prisma.customerCard.findFirst({ where: { id: cardId, shopId: user.shopId } })
  if (!card || card.type !== 'count') throw new Error('次卡不存在')
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CustomerCard" WHERE id = ${cardId} FOR UPDATE`
    const cc = await tx.customerCard.findUnique({ where: { id: cardId }, select: { remainingCount: true } })
    const rem = cc?.remainingCount ?? 0
    if (rem <= 0) throw new Error('次卡次数不足')
    await lockOrderForUpdate(tx, orderId)
    const o = await tx.order.findUnique({ where: { id: orderId }, select: { total: true } })
    await tx.customerCard.update({ where: { id: cardId }, data: { remainingCount: rem - 1 } })
    await tx.order.update({ where: { id: orderId }, data: { paidAmount: Number(o?.total ?? 0) } })
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— P3 理赔单（记录损坏/丢失 → 处理方式/金额；存 Order.config.claim[]，拍照已存 photo）——
export async function addLaundryClaim(orderId: string, input: { type: 'damage' | 'lost'; note?: string; resolution: 'refund' | 'partial' | 'credit'; amount: number }) {
  const user = await requireOwner()
  const order = await assertLaundryOrder(user.shopId, orderId) // D 守卫（跨垂直拒绝）
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

// —— 顾客自助下单（公开，不需登录；登录则绑定 customerId）——
// 提交生成「待确认 submitted」单，金额=预估（按当前 rates）；正式金额交接确认时定。
export async function submitCustomerLaundryOrder(slug: string, input: {
  mode: LaundryMode; kg?: number; itemSelections?: { name: string; qty: number }[]
  shoeStyle?: ShoeStyle | null; shoeAddons?: string[]
  itemDetail?: { name: string; count: number; mark?: string }[]
  careType?: string; dispatchType?: 'in_store' | 'pickup' | 'deliver'; address?: string; timeWindow?: string
  customerPhone?: string; customerName?: string; note?: string; idempotencyKey?: string
}) {
  const shop = await prisma.shop.findUnique({ where: { slug }, select: { id: true, config: true, open: true, platformSuspended: true, subscribedUntil: true } })
  if (!shop) throw new Error('店铺不存在')
  if (!shop.open) throw new Error('店铺已打烊')
  // 审计六轮 N：对齐通用下单（createOrder/addItems）——平台停用/订阅到期的店拒绝自助接单（此前只拦打烊，停用店仍能收自助单）
  if (shop.platformSuspended) throw new Error('店铺暂停营业')
  if (await isShopExpired(shop)) throw new Error('店铺已到期')
  const rates = readRates(shop)
  if (!rates) throw new Error('店铺未配置计价')
  if (!input.mode) throw new Error('请选择计价模式')
  const { total } = computeLaundryTotal(rates, input)
  if (total <= 0) throw new Error('订单内容为空')
  const deliveryFee = deliveryFeeOf((shop.config ?? {}) as Record<string, unknown>, input.dispatchType) // 审计五轮 M：deliver 送到家才收；预估与交接正式金额都含配送费（config 锁存防交接丢）
  // 登录则绑定 customerId，游客用手机号
  let customerId: string | null = null
  try {
    const session = (await auth()) as { user?: { customerId?: string } } | null
    if (session?.user?.customerId) customerId = session.user.customerId
  } catch { /* ignore */ }
  const customerPhone = input.customerPhone ? normalizePhone(input.customerPhone) : null
  if (customerPhone && !PHONE_RE.test(customerPhone)) throw new Error('手机号格式不正确') // 审计四轮 I：填了必过格式，防非法号落库（对齐 food createOrder）
  // 匿名自助下单防刷（审计四轮 I ②）：无登录会话 → 按 IP 频率限流（宽松 10 次/60s），命中即拒。
  // 有登录会话（customerId 有账号成本）不入此桶。走语义中性的动作频率原语 isHitLimited/recordHit
  //（审计四轮 L 纯净化：非失败限流——成功提交只作普通窗口计数，不挂失败 history/封禁路径）先查后记，
  // 窗口内提交次数达上限即拦下一批；窗口到期自动释放。
  if (!customerId) {
    const h = await headers()
    const fwd = h.get('x-forwarded-for')
    const ip = (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip')?.trim()) || 'unknown'
    const keyIp = `laundry-submit:ip:${ip}`
    if (isHitLimited(keyIp, ANON_SUBMIT_OPTS)) throw new Error('提交过于频繁，请稍后再试')
    recordHit(keyIp, ANON_SUBMIT_OPTS)
  }
  const idem = input.idempotencyKey?.trim() || null
  const order = await prisma.$transaction(async (tx) => {
    await lockShopForUpdate(tx, shop.id)
    const { orderNo, displayNo } = await nextOrderNumbers(tx, shop.id, 'LD')
    const shopInTx = await tx.shop.findUnique({ where: { id: shop.id }, select: { config: true } })
    const scfg = (shopInTx?.config ?? {}) as Record<string, unknown>
    const code = `#${String(Math.min(Number(scfg.laundryTagSeq ?? 0) + 1, TAG_CODE_MAX)).padStart(3, '0')}`
    await tx.shop.update({ where: { id: shop.id }, data: { config: { ...scfg, laundryTagSeq: Math.min(Number(scfg.laundryTagSeq ?? 0) + 1, TAG_CODE_MAX) } as Prisma.InputJsonValue } })
    return tx.order.create({
      data: {
        orderNo, displayNo, shopId: shop.id, status: 'PENDING', items: [{ name: input.mode, qty: 1, price: total }] as Prisma.InputJsonValue,
        total: total + deliveryFee, paidAmount: 0, customerId, customerPhone, customerName: input.customerName?.trim() || null,
        note: input.note?.trim() || null, idempotencyKey: idem,
        config: {
          laundryMode: input.mode, laundryStatus: 'submitted', tagCode: code, // 待老板交接确认
          ...(input.mode === 'kg' ? { kg: Math.max(Number(input.kg ?? 0), 0) } : {}),
          ...(input.mode === 'item' ? { itemNames: (input.itemSelections ?? []).map((s) => s.name) } : {}),
          ...(input.mode === 'shoe' ? { shoeStyle: input.shoeStyle ?? null, shoeAddonNames: (input.shoeAddons ?? []) } : {}),
          ...(input.itemDetail ? { itemDetail: input.itemDetail } : {}),
          ...(input.careType ? { careType: input.careType } : {}),
          ...(input.dispatchType ? { dispatchType: input.dispatchType, address: input.address ?? null, timeWindow: input.timeWindow ?? null } : {}),
          ...(deliveryFee > 0 ? { deliveryFee } : {}), // 审计五轮 M：锁存提交时店配费，交接重算不丢
          estimated: true, // 金额为预估，正式金额交接时定
        } as Prisma.InputJsonValue,
      },
    })
  })
  revalidatePath('/[locale]/dashboard', 'page')
  return { displayNo: order.displayNo, tagCode: (order.config as { tagCode?: string } | null)?.tagCode ?? null }
}

// —— 老板交接确认：现场核对(可改清单) → 出具正式凭证(ticketId) → 转「待洗」——
// itemsOverride 允许老板改清单后按新价重算正式金额；不传则按顾客提交的 items/customerItems
export async function confirmLaundryHandover(orderId: string, override?: { items?: { name: string; qty: number; price: number }[]; itemDetail?: { name: string; count: number; mark?: string }[] }) {
  const user = await requireOwner()
  const order = await assertLaundryOrder(user.shopId, orderId)
  const cfg = (order.config as Record<string, unknown> | null) ?? {}
  if (cfg.laundryStatus !== 'submitted') throw new Error('仅待确认单可交接')
  const shop = await prisma.shop.findUnique({ where: { id: user.shopId }, select: { config: true } })
  const rates = readRates(shop)
  const curItems = (order.items as { name: string; qty: number; price: number }[]) ?? []
  const officialItems = override?.items?.length ? override.items : curItems
  const laundryTotal = officialItems.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0)
  // 配送费（审计五轮 M）：优先用提交时锁存的 config.deliveryFee（顾客所见价锁定）；老自助单无锁存则按店现值兜底
  const cfgFee = Number(cfg.deliveryFee ?? 0) || deliveryFeeOf((shop?.config ?? {}) as Record<string, unknown>, cfg.dispatchType as string)
  const officialTotal = laundryTotal + cfgFee
  const newCfg = {
    ...cfg,
    laundryStatus: 'washing_pending',
    ticketId: crypto.randomUUID(),   // 交接时出具正式凭证
    estimated: false,
    ...(cfgFee > 0 ? { deliveryFee: cfgFee } : {}), // 补写/保留配送费（老单无锁存时落值，供凭证与后续读取）
    ...(override?.itemDetail ? { itemDetail: override.itemDetail } : {}),
  }
  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'PENDING', total: officialTotal > 0 ? officialTotal : order.total, items: officialItems as Prisma.InputJsonValue, config: newCfg as Prisma.InputJsonValue },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— B2 进行中 N（未结单数：submitted/待洗/洗涤中/质检/待取，不含已取/取消）——
export async function countLaundryActive() {
  const user = await requireOwner()
  const orders = await prisma.order.findMany({
    where: { shopId: user.shopId, status: { not: 'CANCELLED' } },
    select: { config: true },
  })
  const ACTIVE = ['submitted', 'washing_pending', 'washing', 'qc', 'ready']
  return orders.filter((o) => ACTIVE.includes((o.config as Record<string, unknown> | null)?.laundryStatus as string)).length
}

// —— C1 订单搜索：检索本店全部订单（不限日期），按 单号/取件码/手机号/客户名，默认最多 50 条 ——
export async function searchLaundryOrders(query: string) {
  const user = await requireOwner()
  const q = (query ?? '').trim()
  if (!q) return []
  const rows = await prisma.order.findMany({
    where: {
      shopId: user.shopId,
      OR: [
        { displayNo: { contains: q, mode: 'insensitive' } },
        { customerPhone: { contains: q } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { config: { path: ['tagCode'], string_contains: q } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return rows.map(serializeLaundryOrder)
}
