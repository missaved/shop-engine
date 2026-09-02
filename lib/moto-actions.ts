'use server'
// MOTO 老板端 server actions：车牌档案 + 快捷开单 + 进度推进 + 收款 + 凭证
// 全部 requireOwner + assertShopOwned（租户隔离）；moto 专属动作再校验 vertical（assertMotoShop）
// 保养字段更新时机 = picked_up（交接）时，见计划 8.2（createMotoOrder 只开单不写保养）
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireOwner } from '@/lib/dal'
import { assertShopOwned } from '@/lib/tenant'
import { normalizePhone } from '@/lib/phone'
import { normalizePlate } from '@/lib/plate'
import { vietnamTodayStartUtc } from '@/lib/dashboard-orders'
import { extractVehicleFromPhoto } from './ocr'
import {
  MAX_ORDER_AMOUNT,
  lockShopForUpdate,
  nextOrderNumbers,
  findIdempotentOrder,
} from '@/lib/order-shared'
import { motoItemKind } from '@/components/moto/types'

// —— 常量与类型 ——
// moto 细化进度流（唯一权威，见计划 10.6）；取消单走公共 Order.status=CANCELLED，motoProgress 置空
const PROGRESS_SEQ = [
  'queued',
  'diagnosing',
  'quoted',
  'repairing',
  'waiting_pickup',
  'picked_up',
] as const
export type MotoProgress = (typeof PROGRESS_SEQ)[number]

// motoProgress → 公共 OrderStatus 映射（计划 10.6）
const PROGRESS_STATUS: Record<MotoProgress, string> = {
  queued: 'PENDING',
  diagnosing: 'IN_PROGRESS',
  quoted: 'IN_PROGRESS',
  repairing: 'IN_PROGRESS',
  waiting_pickup: 'READY',
  picked_up: 'COMPLETED',
}

// 开单服务项：kind 区分配件/工费（凭证页分列）；保养参数随单快照（防预设后续改价漂移）
export type MotoServiceItem = {
  name: string
  qty: number
  price: number
  kind: 'part' | 'labor'
  maintenanceType?: 'OIL' | 'PERIODIC' | 'REPAIR'
  intervalKm?: number | null
  intervalDays?: number | null
}

// —— 保养计算（计划 8.2）——
// OIL 双维度：nextServiceKm=mileage+intervalKm(默认2000) 且 nextServiceDue=now+intervalDays(默认180) 天，先到先提醒
// PERIODIC 日期为主：nextServiceDue=now+intervalDays(默认120)，附带里程 nextServiceKm=mileage+intervalKm(默认4000)
// REPAIR 不写保养；多保养服务取「最保守」（km 最小 / due 最早），防漏提醒
function computeNextMaintenance(
  vehicleMileage: number | null,
  items: { maintenanceType?: string; intervalKm?: number | null; intervalDays?: number | null }[],
  now = new Date(),
): { nextServiceKm: number | null; nextServiceDue: Date | null } {
  let km: number | null = null
  let due: Date | null = null
  const takeKm = (v: number) => (km == null ? v : Math.min(km, v))
  const takeDue = (d: Date) => (due == null ? d : new Date(Math.min(due.getTime(), d.getTime())))
  for (const it of items) {
    if (it.maintenanceType === 'OIL') {
      if (vehicleMileage != null) km = takeKm(vehicleMileage + (it.intervalKm ?? 2000))
      due = takeDue(new Date(now.getTime() + (it.intervalDays ?? 180) * 24 * 60 * 60 * 1000))
    } else if (it.maintenanceType === 'PERIODIC') {
      due = takeDue(new Date(now.getTime() + (it.intervalDays ?? 120) * 24 * 60 * 60 * 1000))
      if (vehicleMileage != null) km = takeKm(vehicleMileage + (it.intervalKm ?? 4000))
    }
  }
  return { nextServiceKm: km, nextServiceDue: due }
}

// Reminder.dueAt 精确算法（计划 8.2）：日期维度 dueAt=nextServiceDue-14 天；
// 若当前里程剩余 ≤200km 则 dueAt=立即；取更早
function serviceReminderDueAt(
  nextServiceDue: Date,
  nextServiceKm: number | null,
  vehicleMileage: number | null,
  now = new Date(),
): Date {
  const due14 = new Date(nextServiceDue.getTime() - 14 * 24 * 60 * 60 * 1000)
  if (nextServiceKm != null && vehicleMileage != null && nextServiceKm - vehicleMileage <= 200) {
    return now // 剩余里程不足 → 立即冒泡
  }
  return due14
}

// —— 车辆档案 ——

// 车牌查档案：normalize 后精确匹配（OCR 与手输统一）；返回 null=无档案（前端提示新建）
export async function findVehicleByPlate(rawPlate: string) {
  const user = await requireOwner()
  const plate = normalizePlate(rawPlate)
  if (!plate) return null
  const v = await prisma.vehicle.findUnique({
    where: { shopId_plate: { shopId: user.shopId, plate } },
    include: { ownerCustomer: { select: { id: true, name: true } } },
  })
  return v
}

// 保存/新建车辆档案（M2.3 档案管理页用；开单向导走 createMotoOrder 内联建档）
export async function saveVehicle(input: {
  plate: string
  brand?: string
  model?: string
  year?: number | null
  mileage?: number | null
  ownerName?: string
  ownerPhone?: string
  notes?: string
}) {
  const user = await requireOwner()
  const plate = normalizePlate(input.plate)
  if (!plate) throw new Error('车牌不能为空')
  const ownerPhone = input.ownerPhone ? normalizePhone(input.ownerPhone) : undefined
  const data = {
    brand: input.brand?.trim() || null,
    model: input.model?.trim() || null,
    year: input.year ?? null,
    mileage: input.mileage ?? null,
    ownerName: input.ownerName?.trim() || null,
    ownerPhone: ownerPhone || null,
    notes: input.notes?.trim() || null,
  }
  const v = await prisma.vehicle.upsert({
    where: { shopId_plate: { shopId: user.shopId, plate } },
    update: data,
    create: { shopId: user.shopId, plate, ...data },
  })
  revalidatePath('/[locale]/dashboard', 'page')
  return v
}

// —— 快捷开单 ——

// 开单（7 步向导第 7 步「开工」）：事务锁号 + 建档（开单即建档）+ 写 moto config。
// total=Σ(qty*price)-discount；欠款由 total-paidAmount 推导（不独立存，防双写）。
// 保养字段不在此更新（picked_up 交接时才写，见 8.2）。
export async function createMotoOrder(input: {
  plate: string
  vehicleId?: string
  brand?: string
  model?: string
  year?: number | null
  mileage?: number | null
  ownerName?: string
  ownerPhone?: string
  symptoms: string[]
  items: MotoServiceItem[]
  discount?: number
  estimatedDue?: string
  note?: string
  photos?: string[]
  idempotencyKey?: string
}) {
  const user = await requireOwner()
  const plate = normalizePlate(input.plate)
  if (!plate) throw new Error('车牌不能为空')
  if (!input.items?.length) throw new Error('请至少添加一项服务')
  const symptoms = (input.symptoms ?? []).map((s) => s.trim()).filter(Boolean)

  const subtotal = input.items.reduce((s, it) => s + it.price * it.qty, 0)
  const discount = Math.min(Math.max(Number(input.discount ?? 0), 0), subtotal)
  const total = subtotal - discount
  if (total > MAX_ORDER_AMOUNT) throw new Error('订单金额超出上限')

  // items 快照：含保养参数（picked_up 算保养用）；laborFee 由 kind='labor' 项推导（凭证分列）
  const orderItems = input.items.map((it) => ({
    name: it.name,
    qty: it.qty,
    price: it.price,
    kind: it.kind,
    maintenanceType: it.maintenanceType,
    intervalKm: it.intervalKm ?? null,
    intervalDays: it.intervalDays ?? null,
  }))
  const laborFee = orderItems
    .filter((it) => it.kind === 'labor')
    .reduce((s, it) => s + it.price * it.qty, 0)
  const ownerPhone = input.ownerPhone ? normalizePhone(input.ownerPhone) : null
  const idempotencyKey = input.idempotencyKey?.trim() || null

  try {
    // 幂等去重（防双击/重放，同 food）
    if (idempotencyKey) {
      const existing = await findIdempotentOrder(user.shopId, idempotencyKey)
      if (existing) return { orderNo: existing.orderNo, displayNo: existing.displayNo }
    }

    const order = await prisma.$transaction(async (tx) => {
      await lockShopForUpdate(tx, user.shopId)
      // 取号 + 对外单号（orderNo = max+1；displayNo = MT-YYMMDD-NNN，序号从当日最后一张 displayNo 解析防撞号 P2002）
      const { orderNo, displayNo } = await nextOrderNumbers(tx, user.shopId, 'MT')

      // 建档（开单即建档）：有 vehicleId 则用向导最新值更新档案；无则按 plate 查，查不到创建
      let vehicleId = input.vehicleId ?? null
      if (vehicleId) {
        await tx.vehicle.update({
          where: { id: vehicleId, shopId: user.shopId },
          data: {
            ...(input.brand ? { brand: input.brand.trim() } : {}),
            ...(input.model ? { model: input.model.trim() } : {}),
            ...(input.year != null ? { year: input.year } : {}),
            ...(input.mileage != null ? { mileage: input.mileage } : {}),
            ...(input.ownerName ? { ownerName: input.ownerName.trim() } : {}),
            ...(ownerPhone ? { ownerPhone } : {}),
          },
        })
      } else {
        const found = await tx.vehicle.findUnique({
          where: { shopId_plate: { shopId: user.shopId, plate } },
          select: { id: true },
        })
        if (found) {
          vehicleId = found.id
        } else {
          const v = await tx.vehicle.create({
            data: {
              shopId: user.shopId,
              plate,
              brand: input.brand?.trim() || null,
              model: input.model?.trim() || null,
              year: input.year ?? null,
              mileage: input.mileage ?? null,
              ownerName: input.ownerName?.trim() || null,
              ownerPhone,
            },
          })
          vehicleId = v.id
        }
      }

      return tx.order.create({
        data: {
          orderNo,
          displayNo,
          shopId: user.shopId,
          status: 'PENDING',
          items: orderItems as Prisma.InputJsonValue,
          total,
          paidAmount: 0,
          customerName: input.ownerName?.trim() || null,
          customerPhone: ownerPhone,
          note: input.note?.trim() || null,
          idempotencyKey,
          config: {
            motoProgress: 'queued',
            vehicleId,
            plate, // 冗余存车牌：订单列表/凭证页直接读，免 join
            symptom: symptoms,
            laborFee,
            discount,
            estimatedDue: input.estimatedDue?.trim() || null,
            ...(input.photos?.length ? { photo: input.photos } : {}),
          },
        },
      })
    })

    revalidatePath('/[locale]/dashboard', 'page')
    return {
      orderNo: order.orderNo,
      displayNo: order.displayNo,
      vehicleId: (order.config as { vehicleId?: string } | null)?.vehicleId ?? null,
    }
  } catch (e) {
    // 幂等兜底：并发双击 unique 冲突 → 查回已建订单返回
    if (
      idempotencyKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const existing = await findIdempotentOrder(user.shopId, idempotencyKey)
      if (existing) return { orderNo: existing.orderNo, displayNo: existing.displayNo, vehicleId: null }
    }
    console.error('moto 开单失败（plate=%s）:', plate, e)
    throw e
  }
}

// —— 进度推进（老板一步一推，客户端只读）——

// 推进到指定阶段：只能前进不可回退（queued→…→picked_up）。
// picked_up（交接）时：status 归档 COMPLETED + 更新 Vehicle 保养字段 + 建 MOTO_SERVICE_DUE 提醒 + 生成凭证 ticketId
export async function updateMotoOrderProgress(orderId: string, progress: MotoProgress) {
  const user = await requireOwner()
  const order = assertShopOwned(
    user.shopId,
    await prisma.order.findUnique({
      where: { id: orderId },
      include: { shop: { select: { vertical: true } } },
    }),
  )
  if (order.shop.vertical !== 'MOTO') throw new Error('非 moto 店订单')
  const cur = (order.config as { motoProgress?: string } | null)?.motoProgress ?? null
  const curIdx = cur ? PROGRESS_SEQ.indexOf(cur as MotoProgress) : -1
  const nextIdx = PROGRESS_SEQ.indexOf(progress)
  if (nextIdx < 0) throw new Error('非法进度')
  if (curIdx >= nextIdx && progress !== 'picked_up') throw new Error('进度不能回退')

  const cfg = (order.config as Record<string, unknown> | null) ?? {}
  const items = (order.items as unknown as {
    maintenanceType?: string
    intervalKm?: number | null
    intervalDays?: number | null
  }[]) ?? []

  // picked_up 交接：保养更新 + 提醒生成 + 凭证 id 一起完成（同一事务，防中断不一致）
  if (progress === 'picked_up') {
    const vehicle = order.config && (order.config as { vehicleId?: string }).vehicleId
      ? await prisma.vehicle.findUnique({
          where: { id: (order.config as { vehicleId: string }).vehicleId },
        })
      : null
    const maint = vehicle
      ? computeNextMaintenance(vehicle.mileage, items)
      : { nextServiceKm: null as number | null, nextServiceDue: null as Date | null }

    const upd: Prisma.OrderUpdateInput = {
      status: 'COMPLETED',
      config: { ...cfg, motoProgress: 'picked_up', ticketId: crypto.randomUUID() },
    }
    if (vehicle && (maint.nextServiceKm != null || maint.nextServiceDue != null)) {
      // 同店同车已有未处理 MOTO_SERVICE_DUE 则跳过建提醒（防重复冒泡，M3 口径）
      const dup = await prisma.reminder.findFirst({
        where: {
          shopId: user.shopId,
          templateKey: 'MOTO_SERVICE_DUE',
          status: 'PENDING',
          payload: { path: ['plate'], equals: vehicle.plate },
        },
        select: { id: true },
      })
      if (!dup) {
        const dueAt = serviceReminderDueAt(
          maint.nextServiceDue!,
          maint.nextServiceKm,
          vehicle.mileage,
        )
        // Reminder 的 orderId 指向本单（关联取消单过滤复用）
        await prisma.reminder.create({
          data: {
            shopId: user.shopId,
            orderId: order.id,
            templateKey: 'MOTO_SERVICE_DUE',
            dueAt,
            status: 'PENDING',
            payload: {
              plate: vehicle.plate,
              brand: vehicle.brand,
              model: vehicle.model,
              ownerName: vehicle.ownerName,
              ownerPhone: vehicle.ownerPhone,
              nextServiceKm: maint.nextServiceKm,
              nextServiceDue: maint.nextServiceDue?.toISOString() ?? null,
            },
          },
        })
      }
      await prisma.vehicle.update({
        where: { id: vehicle.id },
        data: {
          lastServiceAt: new Date(),
          nextServiceKm: maint.nextServiceKm ?? vehicle.nextServiceKm,
          nextServiceDue: maint.nextServiceDue ?? vehicle.nextServiceDue,
          // 间隔天数：取本单保养服务最大 intervalDays（无则保持）
          ...(items.some((it) => it.maintenanceType && it.maintenanceType !== 'REPAIR')
            ? {
                lastIntervalDays: items.reduce(
                  (mx, it) => Math.max(mx, it.intervalDays ?? 0),
                  0,
                ) || vehicle.lastIntervalDays,
              }
            : {}),
        },
      })
    }
    await prisma.order.update({ where: { id: order.id }, data: upd })
    revalidatePath('/[locale]/dashboard', 'page')
    return { ticketId: (upd.config as { ticketId: string }).ticketId }
  }

  // 普通推进：motoProgress + 公共 status（映射 10.6）
  await prisma.order.update({
    where: { id: order.id },
    data: { status: PROGRESS_STATUS[progress] as 'PENDING' | 'IN_PROGRESS' | 'READY', config: { ...cfg, motoProgress: progress } },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// 取消单：公共 Order.status=CANCELLED，motoProgress 置空（凭证页不展示取消单）
export async function cancelMotoOrder(orderId: string) {
  const user = await requireOwner()
  const order = assertShopOwned(
    user.shopId,
    await prisma.order.findUnique({ where: { id: orderId } }),
  )
  const cfg = (order.config as Record<string, unknown> | null) ?? {}
  await prisma.order.update({
    where: { id: orderId },
    data: { status: 'CANCELLED', config: { ...cfg, motoProgress: null } },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— 档案履历 + OCR ——

// 车辆详情：档案 + 该车历史订单 + 同手机号其他车（M2.3 履历展示）
export async function getVehicleDetail(vehicleId: string) {
  const user = await requireOwner()
  const v = assertShopOwned(
    user.shopId,
    await prisma.vehicle.findUnique({ where: { id: vehicleId } }),
  )
  const [orders, samePhoneVehicles] = await Promise.all([
    prisma.order.findMany({
      where: { shopId: user.shopId, config: { path: ['vehicleId'], equals: vehicleId } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    v.ownerPhone
      ? prisma.vehicle.findMany({
          where: { shopId: user.shopId, ownerPhone: v.ownerPhone, id: { not: vehicleId } },
        })
      : Promise.resolve([]),
  ])
  return {
    vehicle: v,
    orders: orders.map((o) => ({
      id: o.id,
      displayNo: o.displayNo,
      status: o.status,
      total: o.total.toString(),
      paidAmount: o.paidAmount.toString(),
      createdAt: o.createdAt.toISOString(),
      progress: (o.config as { motoProgress?: string | null } | null)?.motoProgress ?? null,
      // P2-AP：返回 items，档案页订单履历展示/加删项用
      items: (o.items as MotoServiceItem[]) ?? [],
    })),
    samePhoneVehicles,
  }
}

// 拍照识别：拍车牌/仪表盘 → gemini 视觉 OCR → 车牌+里程（server action 包装，key 在服务端不外泄）
// 客户端传压缩后 dataUrl（≤~1.5MB）；失败抛错，调用端降级手输（计划 10.4 降级链）
export async function motoOcr(imageDataUrl: string): Promise<{ plate?: string; mileage?: number | null }> {
  const user = await requireOwner()
  if (!imageDataUrl.startsWith('data:image/')) throw new Error('图片格式不正确')
  return extractVehicleFromPhoto(imageDataUrl)
}

// 今日维修单列表（老板端订单列表/进度推进）：业务日边界用 UTC+7（同 food）
export async function getMotoOrders() {
  const user = await requireOwner()
  const todayStart = vietnamTodayStartUtc()
  const orders = await prisma.order.findMany({
    where: { shopId: user.shopId, createdAt: { gte: todayStart } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return orders.map((o) => {
    const cfg = (o.config as {
      motoProgress?: string | null
      plate?: string
      symptom?: string[]
      laborFee?: number
      estimatedDue?: string | null
      ticketId?: string | null
    } | null) ?? {}
    return {
      id: o.id,
      displayNo: o.displayNo,
      status: o.status,
      progress: cfg.motoProgress ?? null,
      plate: cfg.plate ?? '',
      symptom: cfg.symptom ?? [],
      laborFee: cfg.laborFee ?? 0,
      estimatedDue: cfg.estimatedDue ?? null,
      total: o.total.toString(),
      paidAmount: o.paidAmount.toString(),
      createdAt: o.createdAt.toISOString(),
      // P2-AP：返回 items，老板端维修中加/删项用
      items: (o.items as MotoServiceItem[]) ?? [],
    }
  })
}

// —— M3 保养提醒 ——

// 保养待办：MOTO_SERVICE_DUE 且已到期（dueAt<=now，M2 生成时按 8.2 口径计算）；
// 同店同车去重在生成侧（picked_up 交接时），此处只读展示
export async function getMotoReminders() {
  const user = await requireOwner()
  const rows = await prisma.reminder.findMany({
    where: {
      shopId: user.shopId,
      templateKey: 'MOTO_SERVICE_DUE',
      status: 'PENDING',
      dueAt: { lte: new Date() },
    },
    orderBy: { dueAt: 'asc' },
  })
  return rows.map((r) => {
    const p = (r.payload as {
      plate?: string
      brand?: string | null
      model?: string | null
      ownerName?: string | null
      ownerPhone?: string | null
      nextServiceKm?: number | null
      nextServiceDue?: string | null
    } | null) ?? {}
    return {
      id: r.id,
      orderId: r.orderId,
      plate: p.plate ?? '',
      brand: p.brand ?? null,
      model: p.model ?? null,
      ownerName: p.ownerName ?? null,
      ownerPhone: p.ownerPhone ?? null,
      nextServiceKm: p.nextServiceKm != null ? String(p.nextServiceKm) : null,
      nextServiceDue: p.nextServiceDue ?? null,
    }
  })
}

// —— M4 概览 + 流水 + 设置 ——

// 本店预设大按钮（server 侧类型，与组件 types.ts MotoPresetItem 对齐）
export type MotoPresetItemPlain = {
  serviceKey: string
  name: string
  nameZh?: string
  nameEn?: string
  price: string
  unit?: string | null
  category?: string
  maintenanceType?: string
  intervalKm?: number | null
  intervalDays?: number | null
}

// 概览统计：今日实收 / 待取车辆 / 待提醒 / 欠款总额
// 欠款不独立存（计划 10.7），由 total-paidAmount 推导，防双写；waiting_pickup 全店范围（含历史日）
export async function getMotoOverview() {
  const user = await requireOwner()
  const todayStart = vietnamTodayStartUtc()
  const [todayOrders, activeOrders, waitingPickup, dueReminders] = await Promise.all([
    prisma.order.findMany({
      where: { shopId: user.shopId, createdAt: { gte: todayStart }, status: { not: 'CANCELLED' } },
      select: { paidAmount: true },
    }),
    prisma.order.findMany({
      where: { shopId: user.shopId, status: { not: 'CANCELLED' } },
      select: { total: true, paidAmount: true },
    }),
    prisma.order.count({
      where: { shopId: user.shopId, config: { path: ['motoProgress'], equals: 'waiting_pickup' } },
    }),
    prisma.reminder.count({
      where: {
        shopId: user.shopId,
        templateKey: 'MOTO_SERVICE_DUE',
        status: 'PENDING',
        dueAt: { lte: new Date() },
      },
    }),
  ])
  const todayRevenue = todayOrders.reduce((s, o) => s + Number(o.paidAmount), 0)
  const debtTotal = activeOrders.reduce(
    (s, o) => s + Math.max(Number(o.total) - Number(o.paidAmount), 0),
    0,
  )
  return {
    todayRevenue: todayRevenue.toString(),
    waitingPickup,
    dueReminders,
    debtTotal: debtTotal.toString(),
  }
}

// —— 营业收入多档（今天/3天/7天/30天，营收同口径：排除取消 + paidAmount，业务日滚动）——
export async function getMotoRevenue() {
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

// 指定越南日期的 UTC 区间（dateStr='YYYY-MM-DD' 越南本地日；与 vietnamTodayStartUtc 同口径 UTC+7）
function vietnamDayRangeUtc(dateStr: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const VIET_OFFSET = 7 * 60 * 60 * 1000
  const localStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  return {
    start: new Date(localStart.getTime() - VIET_OFFSET),
    end: new Date(localStart.getTime() + 24 * 60 * 60 * 1000 - VIET_OFFSET),
  }
}

// 流水视图：按越南日查询；income=当日实收合计，rows 含 debt（欠款不独立存）
export async function getMotoLedger(date: string) {
  const user = await requireOwner()
  const { start, end } = vietnamDayRangeUtc(date)
  const orders = await prisma.order.findMany({
    where: { shopId: user.shopId, createdAt: { gte: start, lt: end }, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const income = orders.reduce((s, o) => s + Number(o.paidAmount), 0)
  const rows = orders.map((o) => {
    const cfg = (o.config as { plate?: string; motoProgress?: string | null } | null) ?? {}
    const debt = Math.max(Number(o.total) - Number(o.paidAmount), 0)
    return {
      id: o.id,
      displayNo: o.displayNo,
      plate: cfg.plate ?? '',
      progress: cfg.motoProgress ?? null,
      total: o.total.toString(),
      paidAmount: o.paidAmount.toString(),
      debt: debt.toString(),
      createdAt: o.createdAt.toISOString(),
    }
  })
  return { date, income: income.toString(), rows }
}

// 中台预设库（MotoPreset active）：店主设置页「从预设库添加」拉取
export async function getMotoPresetCatalog() {
  await requireOwner()
  const rows = await prisma.motoPreset.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  })
  return rows.map((r) => ({
    serviceKey: r.serviceKey,
    nameVi: r.nameVi,
    nameZh: r.nameZh,
    nameEn: r.nameEn,
    price: r.defaultPrice.toString(),
    unit: r.unit,
    category: r.category,
    maintenanceType: r.maintenanceType,
    intervalKm: r.intervalKm,
    intervalDays: r.intervalDays,
  }))
}

// 设置保存：常见车型 + 收款信息（垂直差异进 Shop.config，dashboard/seed 同源读取）
// payment 结构（计划 3 节）：{ bank: { bankName, accountNo, accountName }, wallet: { momoQrUrl, zalopayQrUrl } }
export async function saveMotoSettings(input: {
  commonModels?: string[]
  payment?: Record<string, unknown>
}) {
  const user = await requireOwner()
  const shop = await prisma.shop.findUnique({ where: { id: user.shopId } })
  if (!shop) throw new Error('shop not found')
  const cfg = (shop.config as Record<string, unknown> | null) ?? {}
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      config: {
        ...cfg,
        commonModels:
          input.commonModels ?? (Array.isArray(cfg.commonModels) ? cfg.commonModels : []),
        payment:
          input.payment ??
          (cfg.payment && typeof cfg.payment === 'object' ? (cfg.payment as object) : {}),
      },
    },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// 店铺基础信息：店名 / 联系电话（moto 设置页「店铺信息」）
export async function saveMotoShopInfo(input: { name?: string; phone?: string | null; openHours?: string; description?: string; descriptionZh?: string; descriptionEn?: string }) {
  const user = await requireOwner()
  const shop = await prisma.shop.findUnique({ where: { id: user.shopId } })
  if (!shop) throw new Error('shop not found')
  const cfg = (shop.config as Record<string, unknown> | null) ?? {}
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(typeof input.phone === 'string' ? { phone: input.phone.trim() || null } : {}),
      config: {
        ...cfg,
        ...(input.openHours != null ? { openHours: input.openHours } : {}),
        ...(input.description != null ? { description: input.description } : {}),
        ...(input.descriptionZh != null ? { descriptionZh: input.descriptionZh } : {}),
        ...(input.descriptionEn != null ? { descriptionEn: input.descriptionEn } : {}),
      } as Prisma.InputJsonValue,
    },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// 本店预设：从预设库添加（serviceKey 去重，防重复大按钮）
export async function addShopMotoPreset(item: MotoPresetItemPlain) {
  const user = await requireOwner()
  const shop = await prisma.shop.findUnique({ where: { id: user.shopId } })
  if (!shop) throw new Error('shop not found')
  const cfg = (shop.config as Record<string, unknown> | null) ?? {}
  const presets = Array.isArray(cfg.presets) ? (cfg.presets as MotoPresetItemPlain[]) : []
  if (!presets.some((p) => p.serviceKey === item.serviceKey)) {
    await prisma.shop.update({
      where: { id: shop.id },
      data: { config: { ...cfg, presets: [...presets, item] } },
    })
  }
  revalidatePath('/[locale]/dashboard', 'page')
}

// 本店预设：移除（服务大按钮从开单向导消失）
export async function removeShopMotoPreset(serviceKey: string) {
  const user = await requireOwner()
  const shop = await prisma.shop.findUnique({ where: { id: user.shopId } })
  if (!shop) throw new Error('shop not found')
  const cfg = (shop.config as Record<string, unknown> | null) ?? {}
  const presets = Array.isArray(cfg.presets) ? (cfg.presets as MotoPresetItemPlain[]) : []
  await prisma.shop.update({
    where: { id: shop.id },
    data: { config: { ...cfg, presets: presets.filter((p) => p.serviceKey !== serviceKey) } },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— 收款（交车即完结的补录实收，拍板 A）——
// food 的 settleOrder 拒绝 COMPLETED 单；moto 专版允许对已完结(COMPLETED)单补录实收：
// 填 = total → 结清；填 < total → 记欠款（欠款 = total-paidAmount，getMotoLedger 已按此推导）。
// 取消了单禁止收款（先取消单再收款属恢复作废单，不允许）。
export async function settleMotoOrder(
  orderId: string,
  input: { paidAmount: number; paymentMethod: 'cash' | 'qr' | 'other' },
): Promise<void> {
  const user = await requireOwner()
  try {
    const order = assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({
        where: { id: orderId },
        include: { shop: { select: { vertical: true } } },
      }),
    )
    if (order.shop.vertical !== 'MOTO') throw new Error('非 moto 店订单')
    if (order.status === 'CANCELLED') throw new Error('已取消订单不可收款')

    const amount = Number(input.paidAmount)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('实收金额无效')
    // P3-H 金额上限（复用建单 MAX_ORDER_AMOUNT，防老板误录/伪造超大实收）
    if (amount > MAX_ORDER_AMOUNT) throw new Error('实收金额超出上限')

    const oldCfg = (order.config as Record<string, unknown> | null) ?? {}
    await prisma.order.update({
      where: { id: orderId },
      data: {
        paidAmount: amount,
        config: { ...oldCfg, paymentMethod: input.paymentMethod },
      },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('moto 收款失败（orderId=%s）:', orderId, e)
    throw e
  }
}

// —— P2-AP 维修中加/删服务项（改单：开单后老板可中途加件/删行）——

// 加服务项：仅按 serviceKey 从 MotoPreset 查默认价（服务端计价，不信任客户端传价）；
// 费用守恒：fee=旧 total−旧 subtotal（=开单折扣），加项只增 subtotal。终态（COMPLETED/CANCELLED）守卫。
export async function addMotoItems(
  orderId: string,
  items: { serviceKey: string; qty: number }[],
): Promise<void> {
  const user = await requireOwner()
  const order = assertShopOwned(
    user.shopId,
    await prisma.order.findUnique({ where: { id: orderId } }),
  )
  if (order.status === 'COMPLETED' || order.status === 'CANCELLED')
    throw new Error('订单已结束，不可加项')
  if (!items?.length) throw new Error('请选择服务项')

  // 服务端计价：查 MotoPreset 默认价（kind 与开单 motoItemKind 统一推断）
  const presets = await prisma.motoPreset.findMany({
    where: { serviceKey: { in: items.map((i) => i.serviceKey) } },
  })
  const addItems = items.map((item) => {
    const p = presets.find((x) => x.serviceKey === item.serviceKey)
    if (!p) throw new Error('服务项不存在')
    const qty = Math.trunc(Number(item.qty))
    if (!Number.isFinite(qty) || qty < 1) throw new Error('数量无效')
    return {
      name: p.nameVi,
      price: Number(p.defaultPrice),
      qty,
      kind: motoItemKind(p.maintenanceType),
      maintenanceType: p.maintenanceType as MotoServiceItem['maintenanceType'],
      intervalKm: p.intervalKm,
      intervalDays: p.intervalDays,
    }
  })

  // 费用守恒：fee 不变，只增 subtotal
  const oldItems = (order.items as MotoServiceItem[]) ?? []
  const oldSubtotal = oldItems.reduce((s, it) => s + it.price * it.qty, 0)
  const fee = Number(order.total) - oldSubtotal
  const newSubtotal = oldSubtotal + addItems.reduce((s, it) => s + it.price * it.qty, 0)
  const newTotal = newSubtotal + fee
  if (newTotal > MAX_ORDER_AMOUNT) throw new Error('订单金额超出上限')

  await prisma.order.update({
    where: { id: orderId },
    data: { items: [...oldItems, ...addItems], total: newTotal },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// 删服务项：按 index 删除；费用守恒（删空 items→total 归 0，费用一并取消）。终态守卫。
export async function removeMotoItem(orderId: string, index: number): Promise<void> {
  const user = await requireOwner()
  const order = assertShopOwned(
    user.shopId,
    await prisma.order.findUnique({ where: { id: orderId } }),
  )
  if (order.status === 'COMPLETED' || order.status === 'CANCELLED')
    throw new Error('订单已结束，不可删项')

  const oldItems = (order.items as MotoServiceItem[]) ?? []
  const idx = Math.trunc(Number(index))
  if (!Number.isFinite(idx) || idx < 0 || idx >= oldItems.length) throw new Error('服务项不存在')

  const removed = oldItems[idx].price * oldItems[idx].qty
  const newItems = oldItems.filter((_, i) => i !== idx)
  const oldSubtotal = oldItems.reduce((s, it) => s + it.price * it.qty, 0)
  const fee = Number(order.total) - oldSubtotal
  const newSubtotal = oldSubtotal - removed
  const newTotal = newItems.length === 0 ? 0 : newSubtotal + fee

  await prisma.order.update({
    where: { id: orderId },
    data: { items: newItems, total: newTotal },
  })
  revalidatePath('/[locale]/dashboard', 'page')
}

// —— M2 摩托「进行中 N」：未结单（queued/diagnosing/quoted/repairing/waiting_pickup，不含已提/取消）——
export async function countMotoActive() {
  const user = await requireOwner()
  const orders = await prisma.order.findMany({
    where: { shopId: user.shopId, status: { not: 'CANCELLED' } },
    select: { config: true },
  })
  const ACTIVE = ['queued', 'diagnosing', 'quoted', 'repairing', 'waiting_pickup']
  return orders.filter((o) => ACTIVE.includes((o.config as Record<string, unknown> | null)?.motoProgress as string)).length
}
