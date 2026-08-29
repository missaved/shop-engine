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
      templateKey: { in: ['FOOD_NEW_ORDER', 'FOOD_READY', 'FOOD_ADD'] },
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
  const user = await requireOwner()
  try {
    const order = assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({ where: { id: orderId } }),
    )
    // 终态订单（已结单/已取消）禁止改实收：防「收全款」把已取消单翻回 COMPLETED 并建复购提醒
    if (order.status === 'CANCELLED' || order.status === 'COMPLETED') {
      throw new Error('已结单/已取消订单不可改实收')
    }

    const amount = Number(paidAmount)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('实收金额无效')

    const total = Number(order.total)
    const oldCfg = (order.config as Record<string, unknown> | null) ?? {}
    // 收全款（实收 ≥ total）→ 自动完结；终态守卫在上方已排除 COMPLETED/CANCELLED，此处直接按金额判断
    const willComplete = amount >= total

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

// 推进订单状态（2026-08-29 用户需求修正：一次性推进到「已上桌/待取」，省去 处理中 中间态；
// 推进只到 READY，不自动收款、不完结——收钱是老板确认实收后的独立动作（setOrderPaidAmount）。
// 不建 FOOD_READY 提醒：推进是老板主动操作（餐已上桌/备好），无需再提醒自己）
export async function advanceOrderStatus(orderId: string): Promise<void> {
  const user = await requireOwner()
  try {
    const order = assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({ where: { id: orderId } }),
    )

    // 仅待处理/处理中可推进到已上桌/待取（READY）；READY 之后只剩收钱，不再推进
    if (!['PENDING', 'IN_PROGRESS'].includes(order.status)) {
      throw new Error('当前状态无法推进')
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'READY' },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('推进状态失败（orderId=%s）:', orderId, e)
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
    await prisma.reminder.updateMany({
      where: {
        orderId,
        templateKey: { in: ['FOOD_NEW_ORDER', 'FOOD_READY', 'FOOD_ADD'] },
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
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`
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
    await prisma.reminder.updateMany({
      where: { orderId: order.id, templateKey: 'FOOD_ADD', status: 'PENDING' },
      data: { status: 'DISMISSED' },
    })
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
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`
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

// 店主改密（8.2 决策 + 审计对齐拍板：店主宽松策略 ≥8 位 + 旧密码校验）
export async function changeOwnerPassword(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await requireOwner()
  try {
    if (!oldPassword || !newPassword) throw new Error('旧密码与新密码不能为空')
    if (validateOwnerPassword(newPassword)) throw new Error('新密码至少 8 位')
    // requireOwner 只给 session user（无 passwordHash），改密需重查 DB 校验旧密码
    const owner = await prisma.user.findUnique({ where: { id: user.id } })
    if (!owner) throw new Error('账号不存在')
    const ok = await compare(oldPassword, owner.passwordHash)
    if (!ok) throw new Error('旧密码不正确')
    await prisma.user.update({
      where: { id: owner.id },
      data: { passwordHash: await hash(newPassword, 10) },
    })
    revalidatePath('/[locale]/dashboard', 'page')
  } catch (e) {
    console.error('店主改密失败:', e)
    throw e
  }
}
