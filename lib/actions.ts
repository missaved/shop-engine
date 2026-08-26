// 老板侧 server actions：标记收款 / 售罄 / 营业开关 / 起送价 / 营业时间
// 每个 action 都先 requireUser + assertShopOwned，越权返回 404
'use server'

import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireUser } from '@/lib/dal'
import { assertShopOwned } from '@/lib/tenant'

// 设置实收（E2 支付三态：0=未付，0<实收<total=部分付，≥total=已付；欠款=total-实收）
export async function setOrderPaidAmount(
  orderId: string,
  paidAmount: number,
): Promise<void> {
  const user = await requireUser()
  try {
    assertShopOwned(
      user.shopId,
      await prisma.order.findUnique({ where: { id: orderId } }),
    )

    const amount = Number(paidAmount)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('实收金额无效')

    await prisma.order.update({
      where: { id: orderId },
      data: { paidAmount: amount },
    })
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
    } else if (target === 'COMPLETED') {
      await prisma.reminder.create({
        data: {
          shopId: user.shopId,
          orderId,
          templateKey: 'FOOD_REPURCHASE_21D',
          dueAt: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
          payload: {
            displayNo: order.displayNo,
            customerPhone: order.customerPhone,
          },
        },
      })
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
