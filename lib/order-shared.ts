// 订单跨垂直公共 helper：锁行（Shop/Order）/ 取号 / 幂等 / 提醒 dismiss 等「逐字一致、无业务差异」的机械段。
// 只放纯流水；垂直线校验/计价/config/提醒生成各自保留（YAGNI，不抽 createOrderCore）。
// data/algorithm 层面复用，非流程层面——避免把 food 的桌号互斥、moto 的车辆建档等不对称逻辑强行塞进公共函数。
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

// 单订单金额上限（VND，防伪造巨款/数值溢出）。统一 food（shop-actions）与 moto（moto-actions）两处重复定义的同值常量。
export const MAX_ORDER_AMOUNT = 50_000_000

// 锁 Shop 行：串行化同店「取号 + 建单」。必须在与 create 同一事务内调用，否则取号与建单的原子性被破坏（会被插队撞号 P2002）。
// SQL 字符串两处逐字相同（food :149 / moto :195），仅在锁内、与 create 同事务才正确。
export async function lockShopForUpdate(
  tx: Prisma.TransactionClient,
  shopId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Shop" WHERE id = ${shopId} FOR UPDATE`
}

// 取号 + 对外单号：orderNo = 全局 max+1；displayNo = `${prefix}-${dayPrefix}-${padStart(3, lastSeq+1)}`。
// lastSeq 从「当日最后一张 displayNo 的序号」解析，而非 count+1（订单有空洞/删除时 count+1 会撞号 P2002）。
// now 由调用方传入：food 的 now 在事务外复用于建单提醒 dueAt；moto 不关心 now、用默认当前时间。
export async function nextOrderNumbers(
  tx: Prisma.TransactionClient,
  shopId: string,
  prefix: string,
  now: Date = new Date(),
): Promise<{ orderNo: number; displayNo: string; dayPrefix: string }> {
  const dayPrefix =
    String(now.getFullYear()).slice(-2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0')
  const max = await tx.order.aggregate({
    where: { shopId },
    _max: { orderNo: true },
  })
  const orderNo = (max._max.orderNo ?? 0) + 1
  const lastOrder = await tx.order.findFirst({
    where: { shopId, displayNo: { startsWith: `${prefix}-${dayPrefix}-` } },
    orderBy: { displayNo: 'desc' },
    select: { displayNo: true },
  })
  const lastSeq = lastOrder?.displayNo
    ? Number(lastOrder.displayNo.split('-').pop() ?? '0')
    : 0
  const displayNo = `${prefix}-${dayPrefix}-${String(lastSeq + 1).padStart(3, '0')}`
  return { orderNo, displayNo, dayPrefix }
}

// 幂等预查 / P2002 并发撞号兜底共用的同一份 findUnique 查询。
// 返回订单行（含 orderNo/displayNo），由调用方决定返回 shape（moto 额外带 vehicleId）。
export async function findIdempotentOrder(
  shopId: string,
  idempotencyKey: string,
): Promise<Awaited<ReturnType<typeof prisma.order.findUnique>>> {
  return prisma.order.findUnique({
    where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
  })
}

// 锁 Order 行：串行化同单「加菜/删菜/进度」等读写（与客户侧 addItemsToMyOrder 同一把锁，防同一单并发丢更新）。
// SQL 三处逐字相同（actions.ts:715/759、shop-actions.ts:441），必须在最终写入同一事务内调用。
export async function lockOrderForUpdate(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`
}

// 批量 dismiss 某单的 PENDING 提醒（新单/出餐/加菜待办清理）。同一条 updateMany 在 3 处重复（finalizeOrder/cancelOrder/老板加菜 addItemsToOrder；
// 客户 addItemsToMyOrder 是 create FOOD_ADD 非 dismiss，不走此 helper）。
// templateKeys 传 3 个（FOOD_NEW_ORDER/FOOD_READY/FOOD_ADD）或单 key（如 ['FOOD_ADD']）。
export async function dismissOrderReminders(
  orderId: string,
  templateKeys: string[],
): Promise<void> {
  await prisma.reminder.updateMany({
    where: {
      orderId,
      templateKey: { in: templateKeys },
      status: 'PENDING',
    },
    data: { status: 'DISMISSED' },
  })
}
