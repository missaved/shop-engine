// 老板侧 server actions：标记收款 / 售罄 / 营业开关 / 起送价 / 营业时间
// 每个 action 都先 requireUser + assertShopOwned，越权返回 404
'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireUser } from '@/lib/dal'
import { assertShopOwned, getShopBySlug } from '@/lib/tenant'
import { isRateLimited, recordFailure } from '@/lib/rate-limit'

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
  await prisma.reminder.updateMany({
    where: {
      orderId: order.id,
      templateKey: { in: ['FOOD_NEW_ORDER', 'FOOD_READY'] },
      status: 'PENDING',
    },
    data: { status: 'DISMISSED' },
  })
}

// 设置实收（E2 支付三态：0=未付，0<实收<total=部分付，≥total=已付；欠款=total-实收）
// paymentMethod：支付方式（现金/扫码/其他），写 order.config.paymentMethod；收全款自动完结订单
export async function setOrderPaidAmount(
  orderId: string,
  paidAmount: number,
  paymentMethod?: 'cash' | 'qr' | 'other',
): Promise<void> {
  const user = await requireUser()
  try {
    const order = assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({ where: { id: orderId } }),
    )

    const amount = Number(paidAmount)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('实收金额无效')

    const total = Number(order.total)
    const oldCfg = (order.config as Record<string, unknown> | null) ?? {}
    // 收全款（实收 ≥ total）→ 自动完结，无需再手动推进
    const willComplete = amount >= total && order.status !== 'COMPLETED'

    await prisma.order.update({
      where: { id: orderId },
      data: {
        paidAmount: amount,
        ...(willComplete ? { status: 'COMPLETED' as const } : {}),
        config: {
          ...oldCfg,
          ...(paymentMethod ? { paymentMethod } : {}),
        } as Prisma.InputJsonValue,
      },
    })
    if (willComplete) await finalizeOrder(order, user.shopId)
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('设置实收失败（orderId=%s）:', orderId, e)
    throw e
  }
}

// 推进订单状态（B10：PENDING→IN_PROGRESS→READY→COMPLETED）
export async function advanceOrderStatus(orderId: string): Promise<void> {
  const user = await requireUser()
  try {
    const order = assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({ where: { id: orderId } }),
    )

    const next = {
      PENDING: 'IN_PROGRESS',
      IN_PROGRESS: 'READY',
      READY: 'COMPLETED',
    } as const
    const target = next[order.status as keyof typeof next]
    if (!target) throw new Error('当前状态无法推进')

    // 推进到「完毕」前必须先收全款（收全款本身会自动完结，此处拦截未收款的手动推进）
    if (target === 'COMPLETED' && Number(order.paidAmount) < Number(order.total)) {
      throw new Error('PAY_FIRST')
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: target },
    })

    // D2 完成通知（到 READY）/ D3 复购提醒（到 COMPLETED，21 天后）
    if (target === 'READY') {
      await prisma.reminder.create({
        data: {
          shopId: user.shopId,
          orderId,
          templateKey: 'FOOD_READY',
          dueAt: new Date(),
          status: 'PENDING',
          payload: {
            displayNo: order.displayNo,
            customerPhone: order.customerPhone,
          },
        },
      })
      // 新单提醒已过时（已出餐），dismiss 掉不再冒泡
      await prisma.reminder.updateMany({
        where: { orderId, templateKey: 'FOOD_NEW_ORDER', status: 'PENDING' },
        data: { status: 'DISMISSED' },
      })
    } else if (target === 'COMPLETED') {
      await finalizeOrder(order, user.shopId)
    }
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('推进状态失败（orderId=%s）:', orderId, e)
    throw e
  }
}

// 取消订单（B10：已结单/已取消不可再取消）
export async function cancelOrder(orderId: string): Promise<void> {
  const user = await requireUser()
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
    await prisma.reminder.updateMany({
      where: {
        orderId,
        templateKey: { in: ['FOOD_NEW_ORDER', 'FOOD_READY'] },
        status: 'PENDING',
      },
      data: { status: 'DISMISSED' },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('取消订单失败（orderId=%s）:', orderId, e)
    throw e
  }
}

// 售罄 / 上架（active 翻转）
export async function toggleProductActive(productId: string): Promise<void> {
  const user = await requireUser()
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
  const user = await requireUser()
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
  const user = await requireUser()
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
}): Promise<void> {
  const user = await requireUser()
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
}): Promise<void> {
  const user = await requireUser()
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
}): Promise<void> {
  const user = await requireUser()
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

    const config = {
      ...oldCfg,
      image: input.image?.trim() ?? '',
      emoji: input.emoji?.trim() || (oldCfg.emoji as string) || '🍽️',
      nameI18n,
      descI18n,
      extras: parseExtras(input.extrasText),
      optionGroups: parseOptionGroups(input.optionGroupsText),
      combo: parseCombo(input.comboText),
      bestseller: input.bestseller ?? (oldCfg.bestseller as boolean) ?? false,
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
  const user = await requireUser()
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
  const user = await requireUser()
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
  const user = await requireUser()
  const max = await prisma.order.aggregate({
    where: { shopId: user.shopId },
    _max: { orderNo: true },
  })
  return max._max.orderNo ?? 0
}

// 呼叫服务员实时性：返回最新 CALL_WAITER 提醒的创建时间戳（轮询判断有无新呼叫）
export async function getLatestCallTs(): Promise<number> {
  const user = await requireUser()
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
): Promise<string | null> {
  const shop = await getShopBySlug(slug)
  const no = orderNo.trim()
  const gk = guestKey?.trim() ?? ''
  const p = phone.trim()
  if (!no || (!gk && !p)) return null

  const h = await headers()
  const fwd = h.get('x-forwarded-for')
  const ip = (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip')?.trim()) || 'unknown'
  const keyIp = `track:ip:${ip}`
  const keyCred = gk ? `track:gk:${gk}` : `track:phone:${p}`
  if (isRateLimited(keyIp) || isRateLimited(keyCred)) return null

  const order = await prisma.order.findFirst({
    where: gk
      ? { shopId: shop.id, displayNo: no, config: { path: ['guestKey'], equals: gk } }
      : { shopId: shop.id, displayNo: no, customerPhone: p },
    select: { status: true },
  })
  if (!order) {
    recordFailure(keyIp)
    recordFailure(keyCred)
    return null
  }
  return order.status
}

// 订单 items 快照结构（含价格/加料/规格，服务端计价后落库）
type StoredOrderItem = {
  productId?: string
  name: string
  qty: number
  price: number | string
  extras?: { name: string; price: number | string }[]
  options?: { group: string; name: string; price: number | string }[]
}

// 单行商品小计：商品价 + 加料价 + 规格价，乘以数量
function itemSubtotal(it: StoredOrderItem): number {
  const extrasSum = (it.extras ?? []).reduce((s, e) => s + Number(e.price), 0)
  const optionsSum = (it.options ?? []).reduce((s, o) => s + Number(o.price), 0)
  return (Number(it.price) + extrasSum + optionsSum) * Number(it.qty)
}

// 第 3 批-12：老板端对已建订单加菜（服务端重算新商品价，费用守恒）
export async function addItemsToOrder(input: {
  orderId: string
  items: { productId: string; qty: number }[]
}): Promise<void> {
  const user = await requireUser()
  try {
    const order = assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({ where: { id: input.orderId } }),
    )
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new Error('订单已结束，不可加菜')
    }

    // 聚合新增数量，过滤无效项（qty 上限 99，对齐下单安全上限）
    const qtyMap = new Map<string, number>()
    for (const it of input.items ?? []) {
      const q = Math.trunc(Number(it.qty))
      if (!Number.isFinite(q) || q <= 0 || q > 99) continue
      qtyMap.set(it.productId, (qtyMap.get(it.productId) ?? 0) + q)
    }
    if (qtyMap.size === 0) throw new Error('请选择要加的商品')

    // 服务端计价：从商品表查价，不信任客户端传价
    const products = await prisma.product.findMany({
      where: { id: { in: [...qtyMap.keys()] }, shopId: user.shopId, active: true },
    })
    if (products.length !== qtyMap.size) throw new Error('部分商品已售罄或不存在')

    const addItems: StoredOrderItem[] = products.map((p) => ({
      productId: p.id,
      name: p.name,
      qty: qtyMap.get(p.id)!,
      price: Number(p.price),
      extras: [],
      options: [],
    }))
    const addSubtotal = addItems.reduce((s, it) => s + itemSubtotal(it), 0)

    // 费用守恒：fee = 旧 total − 旧 subtotal，加菜只加 subtotal
    const oldItems = (order.items as unknown as StoredOrderItem[]) ?? []
    const oldSubtotal = oldItems.reduce((s, it) => s + itemSubtotal(it), 0)
    const fee = Number(order.total) - oldSubtotal
    const newTotal = oldSubtotal + addSubtotal + fee

    await prisma.order.update({
      where: { id: order.id },
      data: {
        items: [...oldItems, ...addItems] as Prisma.InputJsonValue,
        total: newTotal,
      },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('订单加菜失败（orderId=%s）:', input.orderId, e)
    throw e
  }
}

// 第 3 批-12：老板端删除已建订单的某行商品，重算 total
export async function removeItemFromOrder(input: {
  orderId: string
  index: number
}): Promise<void> {
  const user = await requireUser()
  try {
    const order = assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({ where: { id: input.orderId } }),
    )
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new Error('订单已结束，不可删菜')
    }

    const oldItems = (order.items as unknown as StoredOrderItem[]) ?? []
    const idx = Math.trunc(Number(input.index))
    if (idx < 0 || idx >= oldItems.length) throw new Error('商品不存在')

    const removed = itemSubtotal(oldItems[idx])
    const newItems = oldItems.filter((_, i) => i !== idx)
    // 删空 items 时 total 归 0（费用一并取消，避免空单收配送费）
    const newTotal = newItems.length === 0 ? 0 : Number(order.total) - removed

    await prisma.order.update({
      where: { id: order.id },
      data: {
        items: newItems as Prisma.InputJsonValue,
        total: newTotal,
      },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('订单删菜失败（orderId=%s）:', input.orderId, e)
    throw e
  }
}
