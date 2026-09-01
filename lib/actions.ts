// 老板侧 server actions：标记收款 / 售罄 / 营业开关 / 起送价 / 营业时间
// 每个 action 都先 requireUser + assertShopOwned，越权返回 404
'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireOwner } from '@/lib/dal'
import { assertShopOwned, getShopBySlug } from '@/lib/tenant'
import { isRateLimited, recordFailure } from '@/lib/rate-limit'
import { compare, hash } from 'bcryptjs'
import { validateOwnerPassword } from '@/lib/password-policy'
import {
  aggregateCartItems,
  itemSubtotal,
  priceCartItems,
  type CartItem,
  type StoredOrderItem,
} from '@/lib/cart-pricing'
import type { ShopTheme } from '@/lib/theme'
import {
  findOrdersForDashboard,
  serializeOrders,
  vietnamTodayStartUtc,
  type OrderPlain,
} from '@/lib/dashboard-orders'
import { lockOrderForUpdate, dismissOrderReminders, MAX_ORDER_AMOUNT } from '@/lib/order-shared'
// 待办提醒序列化类型（与 page.tsx / reminder-list 共享，避免漂移）
import type { ReminderPlain } from '@/components/dashboard/reminder-list'

// 完结订单：建复购提醒（21 天后）+ dismiss 过时提醒（新单/出餐）。
// 收全款自动完结 / 手动推进到 COMPLETED 共用，避免重复建提醒
async function finalizeOrder(
  order: { id: string; displayNo: string; customerPhone: string | null },
  shopId: string,
): Promise<void> {
  await prisma.reminder.create({
    data: {
      shopId,
      orderId: order.id,
      templateKey: 'FOOD_REPURCHASE_21D',
      dueAt: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
      status: 'PENDING',
      payload: { displayNo: order.displayNo, customerPhone: order.customerPhone },
    },
  })
  await dismissOrderReminders(order.id, ['FOOD_NEW_ORDER', 'FOOD_READY', 'FOOD_ADD'])
}

// 推进订单状态（2026-09-01 用户需求：任意非终态推进一步直达「已上桌/待取」(READY) → 主按钮变「收款」；
// 收款结单走 settleOrder，不再推进。不建 FOOD_READY 提醒：推进是老板主动操作，无需再提醒自己）
export async function advanceOrderStatus(orderId: string): Promise<void> {
  const user = await requireOwner()
  try {
    const order = assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({ where: { id: orderId } }),
    )

    // 一次推进直达 READY（已上桌/待取）：PENDING/IN_PROGRESS 均一步到位；READY 之后只收款（settleOrder），不再推进
    const next: Record<string, string> = {
      PENDING: 'READY',
      IN_PROGRESS: 'READY',
    }
    if (!next[order.status]) throw new Error('当前状态无法推进')

    await prisma.order.update({
      where: { id: orderId },
      data: { status: next[order.status] as 'IN_PROGRESS' | 'READY' },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('推进状态失败（orderId=%s）:', orderId, e)
    throw e
  }
}

// 2026-08-31 收款结单（推进主线最后一步）：设置实收 + 支付方式 + 直接完结订单。
// 不要求实收≥总额——抹零/协商少收也照样结单（status=COMPLETED），
// 这是 boss「收全款 / 抹零 / 改实收结束订单」的统一入口。
export async function settleOrder(
  orderId: string,
  paidAmount: number,
  paymentMethod: 'cash' | 'qr' | 'other',
): Promise<void> {
  const user = await requireOwner()
  try {
    const order = assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({ where: { id: orderId } }),
    )
    // 终态订单禁止再结单（防重复完结/翻回已取消单）
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new Error('已结单/已取消订单不可收款')
    }

    const amount = Number(paidAmount)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('实收金额无效')
    // P3-H 金额上限（复用建单 MAX_ORDER_AMOUNT，防老板误录/伪造超大实收致账务统计异常）
    if (amount > MAX_ORDER_AMOUNT) throw new Error('实收金额超出上限')

    const oldCfg = (order.config as Record<string, unknown> | null) ?? {}
    await prisma.order.update({
      where: { id: orderId },
      data: {
        paidAmount: amount,
        status: 'COMPLETED' as const,
        config: {
          ...oldCfg,
          paymentMethod,
        } as Prisma.InputJsonValue,
      },
    })
    await finalizeOrder(order, user.shopId)
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('收款结单失败（orderId=%s）:', orderId, e)
    throw e
  }
}

// 取消订单（B10：已结单/已取消不可再取消）
export async function cancelOrder(orderId: string): Promise<void> {
  const user = await requireOwner()
  try {
    const order = assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({ where: { id: orderId } }),
    )

    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new Error('已结单/已取消订单不可取消')
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    })
    // 取消订单：清理关联的待办提醒（新单/出餐），避免已取消订单仍冒泡
    await dismissOrderReminders(orderId, ['FOOD_NEW_ORDER', 'FOOD_READY', 'FOOD_ADD'])
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('取消订单失败（orderId=%s）:', orderId, e)
    throw e
  }
}

// 售罄 / 上架（active 翻转）
export async function toggleProductActive(productId: string): Promise<void> {
  const user = await requireOwner()
  try {
    const product = assertShopOwned(
      user.shopId,
      await prisma.product.findUnique({ where: { id: productId } }),
    )

    await prisma.product.update({
      where: { id: productId },
      data: { active: !product.active },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('售罄切换失败（productId=%s）:', productId, e)
    throw e
  }
}

// 商品排序：按传入的 productId 顺序重排 sortOrder（上移/下移后整表重排）
export async function reorderProducts(input: {
  productIds: string[]
}): Promise<void> {
  const user = await requireOwner()
  try {
    // 校验归属：只保留属于当前店的商品 id（防越权）
    const owned = await prisma.product.findMany({
      where: { id: { in: input.productIds }, shopId: user.shopId },
      select: { id: true },
    })
    const ownedIds = new Set(owned.map((p) => p.id))
    const valid = input.productIds.filter((id) => ownedIds.has(id))

    await prisma.$transaction(
      valid.map((id, i) =>
        prisma.product.update({ where: { id }, data: { sortOrder: i } }),
      ),
    )
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('商品排序失败（shopId=%s）:', user.shopId, e)
    throw e
  }
}

// 营业 / 打烊（open 翻转）
export async function toggleShopOpen(): Promise<void> {
  const user = await requireOwner()
  try {
    const shop = await prisma.shop.findUnique({ where: { id: user.shopId } })
    if (!shop) notFound()

    await prisma.shop.update({
      where: { id: user.shopId },
      data: { open: !shop.open },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('营业开关切换失败（shopId=%s）:', user.shopId, e)
    throw e
  }
}

// 更新店铺配置（营业时间 / 起送价 / 配送费），merge 进 shop.config jsonb
export async function updateShopSettings(input: {
  openHours?: string
  minOrderAmount?: number
  deliveryFee?: number
  packingFee?: number
  deliveryArea?: string
  description?: string
  descriptionZh?: string // 店面介绍·中文（2026-08-29 语种混杂修复：按 locale 展示）
  descriptionEn?: string // 店面介绍·英文
  theme?: ShopTheme
}): Promise<void> {
  const user = await requireOwner()
  try {
    const shop = await prisma.shop.findUnique({ where: { id: user.shopId } })
    if (!shop) notFound()

    const config: Record<string, string | number> =
      (shop.config as Record<string, string | number> | null) ?? {}
    if (input.openHours !== undefined) config.openHours = input.openHours
    if (input.minOrderAmount !== undefined) config.minOrderAmount = input.minOrderAmount
    if (input.deliveryFee !== undefined) config.deliveryFee = input.deliveryFee
    if (input.packingFee !== undefined) config.packingFee = input.packingFee
    if (input.deliveryArea !== undefined) config.deliveryArea = input.deliveryArea
    if (input.description !== undefined) config.description = input.description
    if (input.descriptionZh !== undefined) config.descriptionZh = input.descriptionZh
    if (input.descriptionEn !== undefined) config.descriptionEn = input.descriptionEn
    if (input.theme !== undefined) config.theme = input.theme

    await prisma.shop.update({
      where: { id: user.shopId },
      data: { config: config as Prisma.InputJsonValue },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('更新店铺配置失败（shopId=%s）:', user.shopId, e)
    throw e
  }
}

// 解析 "名称 价格" 文本行 → 加料数组（价格可省略默认 0，如 "Thêm bò 20000"）
function parseExtras(text?: string): { name: string; price: number }[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)\s+(\d+)$/)
      if (m) return { name: m[1].trim(), price: Number(m[2]) }
      return { name: line, price: 0 }
    })
    .filter((e) => e.name)
}

// 解析规格组文本行 → optionGroups（每行「组名[*]: 选项1, 选项2|价格」，* 必选，| 选项加价）
function parseOptionGroups(text?: string): {
  name: string
  required: boolean
  options: { name: string; price: number }[]
}[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const ci = line.indexOf(':')
      if (ci < 0) return null
      let name = line.slice(0, ci).trim()
      let required = false
      if (name.endsWith('*')) {
        required = true
        name = name.slice(0, -1).trim()
      }
      const options = line
        .slice(ci + 1)
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
        .map((opt) => {
          const [n, p] = opt.split('|')
          return { name: n.trim(), price: p?.trim() ? Number(p.trim()) : 0 }
        })
        .filter((o) => o.name)
      if (!name || options.length === 0) return null
      return { name, required, options }
    })
    .filter((g) => g !== null)
}

// 解析 "商品名 数量" 文本行 → 套餐组成（数量可省略默认 1，如 "Phở bò tái 1"）
function parseCombo(text?: string): { name: string; qty: number }[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)\s+(\d+)$/)
      if (m) return { name: m[1].trim(), qty: Number(m[2]) }
      return { name: line, qty: 1 }
    })
    .filter((c) => c.name && c.qty > 0)
}

// 新增商品（老板录入：名称/价格/单位/图标/介绍，三语名暂回退主名，B8 再翻译）
export async function createProduct(input: {
  name: string
  price: number
  unit?: string
  category?: string
  emoji?: string
  desc?: string
  image?: string
  extrasText?: string
  optionGroupsText?: string
  comboText?: string
  bestseller?: boolean
  canAddOn?: boolean
}): Promise<void> {
  const user = await requireOwner()
  try {
    const name = input.name?.trim()
    const price = Number(input.price)
    if (!name) throw new Error('请填写商品名')
    if (!Number.isFinite(price) || price <= 0) throw new Error('价格无效')

    const desc = input.desc?.trim() ?? ''
    const config = {
      image: input.image?.trim() ?? '',
      emoji: input.emoji?.trim() || '🍽️',
      nameI18n: { vi: name }, // zh/en 名 B8 翻译时补
      descI18n: { zh: desc, en: desc, vi: desc }, // 三语先同值，B8 再翻译
      extras: parseExtras(input.extrasText),
      optionGroups: parseOptionGroups(input.optionGroupsText),
      combo: parseCombo(input.comboText),
      bestseller: input.bestseller ?? false,
      // 出餐后可追加（默认可追加，老板手动收窄）
      canAddOn: input.canAddOn ?? true,
    }

    // 新商品排末尾：sortOrder = 当前最大 + 1（避免与已排序商品冲突）
    const last = await prisma.product.findFirst({
      where: { shopId: user.shopId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })
    const sortOrder = (last?.sortOrder ?? 0) + 1

    await prisma.product.create({
      data: {
        shopId: user.shopId,
        name,
        price,
        unit: input.unit?.trim() || null,
        category: input.category?.trim() || null,
        sortOrder,
        config,
      },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('新增商品失败（shopId=%s）:', user.shopId, e)
    throw e
  }
}

// 编辑商品：改价/改图/改三语名/改描述（B8 菜单翻译）
export async function updateProduct(input: {
  productId: string
  name: string
  price: number
  unit?: string
  category?: string
  emoji?: string
  image?: string
  nameZh?: string
  nameEn?: string
  descVi?: string
  descZh?: string
  descEn?: string
  extrasText?: string
  optionGroupsText?: string
  comboText?: string
  bestseller?: boolean
  canAddOn?: boolean
}): Promise<void> {
  const user = await requireOwner()
  try {
    const product = assertShopOwned(
      user.shopId,
      await prisma.product.findUnique({ where: { id: input.productId } }),
    )

    const name = input.name?.trim()
    const price = Number(input.price)
    if (!name) throw new Error('请填写商品名')
    if (!Number.isFinite(price) || price <= 0) throw new Error('价格无效')

    // 读旧 config，保留未提供的字段（如 extras）
    const oldCfg = (product.config as Record<string, unknown> | null) ?? {}

    const nameI18n: Record<string, string> = { vi: name }
    if (input.nameZh?.trim()) nameI18n.zh = input.nameZh.trim()
    if (input.nameEn?.trim()) nameI18n.en = input.nameEn.trim()

    const descI18n: Record<string, string> = {}
    if (input.descVi?.trim()) descI18n.vi = input.descVi.trim()
    if (input.descZh?.trim()) descI18n.zh = input.descZh.trim()
    if (input.descEn?.trim()) descI18n.en = input.descEn.trim()

    // 多语言整改（2026-08-29）：编辑保存时按 name 匹配保留旧 nameZh（中文加料/中文规格），
    // 老板改价/改描述不丢中文；改了名才回退（中文缺失时菜单 fallback 到本地语）
    const oldExtras = (oldCfg.extras as { name: string; nameZh?: string }[] | undefined) ?? []
    const oldGroups = (oldCfg.optionGroups as
      | { name: string; nameZh?: string; options: { name: string; nameZh?: string }[] }[]
      | undefined) ?? []
    const extras = parseExtras(input.extrasText).map((ex) => ({
      ...ex,
      nameZh: oldExtras.find((o) => o.name === ex.name)?.nameZh ?? '',
    }))
    const optionGroups = parseOptionGroups(input.optionGroupsText).map((g) => ({
      ...g,
      nameZh: oldGroups.find((og) => og.name === g.name)?.nameZh ?? '',
      options: g.options.map((o) => ({
        ...o,
        nameZh:
          oldGroups.find((og) => og.name === g.name)?.options.find((oo) => oo.name === o.name)?.nameZh ?? '',
      })),
    }))

    const config = {
      ...oldCfg,
      image: input.image?.trim() ?? '',
      emoji: input.emoji?.trim() || (oldCfg.emoji as string) || '🍽️',
      nameI18n,
      descI18n,
      extras,
      optionGroups,
      combo: parseCombo(input.comboText),
      bestseller: input.bestseller ?? (oldCfg.bestseller as boolean) ?? false,
      // 出餐后可追加（未传则沿用旧值，旧数据缺省视为可追加）
      canAddOn: input.canAddOn ?? (oldCfg.canAddOn as boolean | undefined) ?? true,
    }

    await prisma.product.update({
      where: { id: input.productId },
      data: {
        name,
        price,
        unit: input.unit?.trim() || null,
        category: input.category?.trim() || null,
        config,
      },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('编辑商品失败（productId=%s）:', input.productId, e)
    throw e
  }
}

// 标记提醒已发送（老板一键复制发 Zalo 后）
export async function markReminderSent(reminderId: string): Promise<void> {
  const user = await requireOwner()
  try {
    assertShopOwned(
      user.shopId,
      await prisma.reminder.findUnique({ where: { id: reminderId } }),
    )

    await prisma.reminder.update({
      where: { id: reminderId },
      data: { status: 'SENT', sentVia: 'zalo' },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('标记提醒已发送失败（reminderId=%s）:', reminderId, e)
    throw e
  }
}

// 忽略提醒（DISMISSED）
export async function dismissReminder(reminderId: string): Promise<void> {
  const user = await requireOwner()
  try {
    assertShopOwned(
      user.shopId,
      await prisma.reminder.findUnique({ where: { id: reminderId } }),
    )

    await prisma.reminder.update({
      where: { id: reminderId },
      data: { status: 'DISMISSED' },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('忽略提醒失败（reminderId=%s）:', reminderId, e)
    throw e
  }
}

// P1-1 新订单实时性：返回本店当前最大 orderNo（轮询判断有无新单，不返回订单内容）
export async function getLatestOrderNo(): Promise<number> {
  const user = await requireOwner()
  const max = await prisma.order.aggregate({
    where: { shopId: user.shopId },
    _max: { orderNo: true },
  })
  return max._max.orderNo ?? 0
}

// boss 端订单实时性（2026-08-30）：返回本店完整订单列表（OrderPlain[]）。
// 与 getLatestOrderNo 同为 server action 直查库（无 RSC/客户端缓存），供 order-list 轮询 setState，
// 绕开 router.refresh() 的 Router Cache 旧快照问题——toast 与订单列表由此同机制同时到达
export async function getDashboardOrders(): Promise<OrderPlain[]> {
  const user = await requireOwner()
  const orders = await findOrdersForDashboard(user.shopId)
  return serializeOrders(orders, vietnamTodayStartUtc())
}

// 待办提醒实时性（2026-08-31）：返回本店 PENDING 待办（ReminderPlain[]），供 ReminderList 轮询 setState，
// 让新单/呼叫服务员提醒自动出现（原来只首屏渲染，必须 F5）。查询与序列化与 page.tsx 首屏保持一致
export async function getReminders(): Promise<ReminderPlain[]> {
  const user = await requireOwner()
  const reminders = await prisma.reminder.findMany({
    where: { shopId: user.shopId, status: 'PENDING', dueAt: { lte: new Date() } },
    orderBy: { dueAt: 'asc' },
    // 带出关联订单状态 + 下单时间（同 page.tsx）
    include: { order: { select: { status: true, createdAt: true } } },
  })
  return reminders
    .filter((r) => r.order?.status !== 'CANCELLED')
    .map((r) => {
      const p = r.payload as {
        displayNo?: string
        customerName?: string | null
        customerPhone?: string | null
        tableNo?: string | null
        total?: number
        orderType?: string | null
        items?: { name: string; qty: number }[]
      } | null
      return {
        id: r.id,
        orderId: r.orderId,
        templateKey: r.templateKey,
        displayNo: p?.displayNo ?? '',
        customerPhone: p?.customerPhone ?? null,
        customerName: p?.customerName ?? null,
        tableNo: p?.tableNo ?? null,
        total: p?.total != null ? p.total.toString() : '',
        orderType: p?.orderType ?? null,
        orderStatus: r.order?.status ?? null,
        // 订单下单时间：待办实时显示「下单多久」（第16批，客户端 30s tick 刷新）
        orderCreatedAt: r.order?.createdAt?.toISOString() ?? null,
        items: p?.items ?? [],
      }
    })
}

// 呼叫服务员实时性：返回最新 CALL_WAITER 提醒的创建时间戳（轮询判断有无新呼叫）
export async function getLatestCallTs(): Promise<number> {
  const user = await requireOwner()
  const latest = await prisma.reminder.findFirst({
    where: { shopId: user.shopId, templateKey: 'CALL_WAITER' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return latest ? latest.createdAt.getTime() : 0
}

// 客户端查单轮询：按 slug+对外订单号+凭证返回订单状态（供 track 页实时刷新出餐状态）。
// 凭证：游客用 guestKey（可能无手机号），否则用手机号；复用 track 查单限流（IP+凭证双 key）防枚举
export async function getTrackStatus(
  slug: string,
  orderNo: string,
  phone: string,
  guestKey?: string,
  byIp?: boolean,
): Promise<string | null> {
  const shop = await getShopBySlug(slug)
  const no = orderNo.trim()
  const gk = guestKey?.trim() ?? ''
  const p = phone.trim()
  // byIp 模式（IP+30min 兜底单）无需 phone/guestKey，仅按订单号 + 请求 IP 匹配
  if (!no || (!byIp && !gk && !p)) return null

  const h = await headers()
  const fwd = h.get('x-forwarded-for')
  const ip = (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip')?.trim()) || 'unknown'
  const keyIp = `track:ip:${ip}`
  if (isRateLimited(keyIp)) return null
  const keyCred = gk ? `track:gk:${gk}` : `track:phone:${p}`
  if (!byIp && isRateLimited(keyCred)) return null

  const order = await prisma.order.findFirst({
    where: byIp
      ? { shopId: shop.id, displayNo: no, config: { path: ['guestIp'], equals: ip } }
      : gk
        ? { shopId: shop.id, displayNo: no, config: { path: ['guestKey'], equals: gk } }
        : { shopId: shop.id, displayNo: no, customerPhone: p },
    select: { status: true },
  })
  if (!order) {
    recordFailure(keyIp)
    if (!byIp) recordFailure(keyCred)
    return null
  }
  return order.status
}

// Issue7：菜单页检测 guestKey 是否有进行中的单（PENDING/IN_PROGRESS/READY），用于「你有进行中的订单」提示条
export async function getGuestActiveOrder(input: {
  slug: string
  guestKey: string
}): Promise<{ orderNo: string; status: string } | null> {
  if (!input.guestKey) return null
  const shop = await getShopBySlug(input.slug)
  const order = await prisma.order.findFirst({
    where: { shopId: shop.id, config: { path: ['guestKey'], equals: input.guestKey } },
    orderBy: { createdAt: 'desc' },
    select: { displayNo: true, status: true },
  })
  if (!order || !['PENDING', 'IN_PROGRESS', 'READY'].includes(order.status)) return null
  return { orderNo: order.displayNo, status: order.status }
}

// 2026-08-31 堂食桌号锁定：查某桌是否有进行中的单（PENDING/IN_PROGRESS/READY），供
// ① 扫码桌贴码进入 → 命中即进加菜模式（只能加菜不能下新单）；② 加菜时旧设备桌号兜底。
export async function getTableActiveOrder(input: {
  slug: string
  tableNo: string
}): Promise<{ orderNo: string; status: string } | null> {
  const tableNo = input.tableNo?.trim() ?? ''
  if (!tableNo) return null
  const shop = await getShopBySlug(input.slug)
  const order = await prisma.order.findFirst({
    where: {
      shopId: shop.id,
      status: { in: ['PENDING', 'IN_PROGRESS', 'READY'] },
      config: { path: ['tableNo'], equals: tableNo },
    },
    orderBy: { createdAt: 'desc' },
    select: { displayNo: true, status: true },
  })
  if (!order) return null
  return { orderNo: order.displayNo, status: order.status }
}

// 2026-08-31 堂食桌号锁定：返回该店所有「进行中」餐桌号集合，供 TablePicker（门头码入口）挂载时
// 一次拉取，把已被占用的桌号置灰不可点——杜绝门头码误选已被占用的桌。
export async function getOccupiedTables(slug: string): Promise<string[]> {
  const shop = await getShopBySlug(slug)
  const orders = await prisma.order.findMany({
    where: {
      shopId: shop.id,
      status: { in: ['PENDING', 'IN_PROGRESS', 'READY'] },
    },
    select: { config: true },
  })
  const tables = new Set<string>()
  for (const o of orders) {
    const cfg = (o.config as { tableNo?: string } | null) ?? {}
    if (cfg.tableNo?.trim()) tables.add(cfg.tableNo.trim())
  }
  return [...tables]
}

// 第 3 批-12：老板端对已建订单加菜（服务端重算新商品价，费用守恒）
// M2 并发安全：FOR UPDATE 锁 Order 行 + 锁内重读（防与客户加菜并发丢更新）；已处理客户加菜则 dismiss 其 FOOD_ADD
export async function addItemsToOrder(input: {
  orderId: string
  items: CartItem[]
}): Promise<void> {
  const user = await requireOwner()
  try {
    // 聚合 + 运行时校验（M7/M8：qty 聚合上限 / extras、options 类型）
    const { qtyMap, error: aggError } = aggregateCartItems(input.items)
    if (aggError === 'overflow') throw new Error('单个商品数量超出上限')
    if (qtyMap.size === 0) throw new Error('请选择要加的商品')

    // 服务端计价：从商品表查价，不信任客户端传价（复用价格 CartItem 的规格/加料/套餐组装）
    const { items: addItems, subtotal: addSubtotal } = await priceCartItems({
      shopId: user.shopId,
      qtyMap,
      extrasMap: new Map(),
      optionsMap: new Map(),
    })

    const order = await prisma.$transaction(async (tx) => {
      // 锁订单行（与客户 addItemsToMyOrder / removeItemFromOrder 同一把锁，串行化同单读写）
      await lockOrderForUpdate(tx, input.orderId)
      const cur = await tx.order.findUnique({ where: { id: input.orderId } })
      if (!cur) throw new Error('订单不存在')
      if (cur.shopId !== user.shopId) throw new Error('无权操作该订单')
      if (['COMPLETED', 'CANCELLED'].includes(cur.status)) {
        throw new Error('订单已结束，不可加菜')
      }

      // 费用守恒：fee = 旧 total − 旧 subtotal，加菜只加 subtotal
      const oldItems = (cur.items as unknown as StoredOrderItem[]) ?? []
      const oldSubtotal = oldItems.reduce((s, it) => s + itemSubtotal(it), 0)
      const fee = Number(cur.total) - oldSubtotal
      const newTotal = oldSubtotal + addSubtotal + fee

      return tx.order.update({
        where: { id: cur.id },
        data: {
          items: [...oldItems, ...addItems] as Prisma.InputJsonValue,
          total: newTotal,
        },
      })
    })

    // 老板已处理客户加菜：dismiss 该单 PENDING FOOD_ADD（防陈旧待办滞留到终态）
    await dismissOrderReminders(order.id, ['FOOD_ADD'])
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('订单加菜失败（orderId=%s）:', input.orderId, e)
    throw e
  }
}

// 第 3 批-12：老板端删除已建订单的某行商品，重算 total
// M2 并发安全：FOR UPDATE 锁 Order 行 + 锁内重读（防与客户加菜并发丢更新）
export async function removeItemFromOrder(input: {
  orderId: string
  index: number
}): Promise<void> {
  const user = await requireOwner()
  try {
    await prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, input.orderId)
      const cur = await tx.order.findUnique({ where: { id: input.orderId } })
      if (!cur) throw new Error('订单不存在')
      if (cur.shopId !== user.shopId) throw new Error('无权操作该订单')
      if (['COMPLETED', 'CANCELLED'].includes(cur.status)) {
        throw new Error('订单已结束，不可删菜')
      }

      const oldItems = (cur.items as unknown as StoredOrderItem[]) ?? []
      const idx = Math.trunc(Number(input.index))
      if (idx < 0 || idx >= oldItems.length) throw new Error('商品不存在')

      const removed = itemSubtotal(oldItems[idx])
      const newItems = oldItems.filter((_, i) => i !== idx)
      // 删空 items 时 total 归 0（费用一并取消，避免空单收配送费）
      const newTotal = newItems.length === 0 ? 0 : Number(cur.total) - removed

      await tx.order.update({
        where: { id: cur.id },
        data: {
          items: newItems as Prisma.InputJsonValue,
          total: newTotal,
        },
      })
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('订单删菜失败（orderId=%s）:', input.orderId, e)
    throw e
  }
}

// Issue10：设置页「历史订单」查找——按单号/手机号模糊查最近 N 天（默认 90 天）的历史单，只读快照
export type HistoryOrderRow = {
  id: string
  displayNo: string
  status: string
  createdAt: Date
  total: string
  items: unknown
  customerPhone: string | null
  tableNo: string | null
}

export async function searchOrderHistory(input: {
  query?: string
  days?: number
}): Promise<HistoryOrderRow[]> {
  const user = await requireOwner()
  const query = input.query?.trim() ?? ''
  const days = Math.min(Math.max(Number(input.days) || 90, 1), 365)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await prisma.order.findMany({
    where: {
      shopId: user.shopId,
      createdAt: { gte: since },
      ...(query
        ? {
            OR: [
              { displayNo: { contains: query, mode: 'insensitive' } },
              { customerPhone: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return rows.map((o) => ({
    id: o.id,
    displayNo: o.displayNo,
    status: o.status,
    createdAt: o.createdAt,
    total: o.total.toString(),
    items: o.items,
    customerPhone: o.customerPhone,
    tableNo: ((o.config as { tableNo?: string } | null)?.tableNo ?? null),
  }))
}

