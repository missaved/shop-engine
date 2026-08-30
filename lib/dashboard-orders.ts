// 老板端订单列表：查询 + 序列化共享模块
// page.tsx（首屏渲染）与 actions.ts（轮询 setState 实时更新）共用，
// 避免「同逻辑两份实现导致漂移」。仅服务端使用（含 prisma 直查）。

import { prisma } from '@/lib/prisma'

// 订单与店铺的序列化类型（server component / server action 已把 Decimal/Date 转成基础类型）
export type OrderItem = {
  name: string
  qty: number
  price: number | string
  extras?: { name: string; price: number | string }[]
  options?: { group: string; name: string; price: number | string }[]
  combo?: { name: string; qty: number }[]
}
export type OrderPlain = {
  id: string
  orderNo: number
  displayNo: string
  total: string
  paidAmount: string
  customerName: string | null
  customerPhone: string | null
  status: string
  note: string | null
  orderType: string | null
  tableNo: string | null
  address: string | null
  createdAt: string
  // 是否为业务日「今天」（服务端按 UTC+7 计算，见 vietnamTodayStartUtc）
  today: boolean
  items: OrderItem[]
}

// 订单查询排序：进行中（PENDING/IN_PROGRESS/READY）在前，终态（COMPLETED/CANCELLED）在后，组内 createdAt desc
// （Prisma 7 orderBy 仅支持标量 asc/desc，无法单条表达「终态后置」，故拆两次查询拼接）
export async function findOrdersForDashboard(shopId: string) {
  const [active, terminal] = await Promise.all([
    prisma.order.findMany({
      where: { shopId, status: { in: ['PENDING', 'IN_PROGRESS', 'READY'] } },
      orderBy: [{ createdAt: 'desc' }],
    }),
    prisma.order.findMany({
      where: { shopId, status: { in: ['COMPLETED', 'CANCELLED'] } },
      orderBy: [{ createdAt: 'desc' }],
    }),
  ])
  return [...active, ...terminal]
}

// 业务日边界：固定 UTC+7（越南运营时区），避免服务器 UTC 造成的「今日」偏移
// （UTC 0 点 = 越南 07:00，若用服务器 UTC 会把越南今晨 0-7 点的订单误判为历史）
export function vietnamTodayStartUtc(now = new Date()): Date {
  const VIET_OFFSET = 7 * 60 * 60 * 1000
  const vietTodayStart = new Date(now.getTime() + VIET_OFFSET)
  vietTodayStart.setHours(0, 0, 0, 0)
  return new Date(vietTodayStart.getTime() - VIET_OFFSET)
}

// 订单 → OrderPlain 序列化（Decimal/Date → 基础类型；today 按传入的业务日边界计算）
export function serializeOrders(orders: Awaited<ReturnType<typeof findOrdersForDashboard>>, todayStartUtc: Date): OrderPlain[] {
  return orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    displayNo: o.displayNo,
    total: o.total.toString(),
    paidAmount: o.paidAmount.toString(),
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    status: o.status,
    note: o.note,
    orderType: (o.config as { orderType?: string } | null)?.orderType ?? null,
    tableNo: (o.config as { tableNo?: string } | null)?.tableNo ?? null,
    address: (o.config as { address?: string } | null)?.address ?? null,
    createdAt: o.createdAt.toISOString(),
    today: o.createdAt >= todayStartUtc,
    items: o.items as unknown as OrderPlain['items'],
  }))
}
