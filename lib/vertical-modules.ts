// 垂直差异注入点（扩展接口 + 垂直侧实现）。不被 tenant.ts 反向 import（防循环）。
// 「加垂直」= 这里注册一个模块，其余代码零改。
// 注入两类：① 订单域副作用（onOrderCreated，createOrder 事务后调用，垂直自定义建单后动作如 food 发新单提醒）；
// ② 聚合页差异（aggregation，见重构点 #4）。顾客入口由 customerEntry 声明式驱动（见单店页）。
import { prisma } from '@/lib/prisma'
import type { StoredOrderItem } from '@/lib/cart-pricing'
import type { Order, Shop, Vertical } from '@/generated/prisma/client'

// 建单输入（跨垂直的公共子集；细化的垂直校验/副作用在 hook 内部展开）
export interface RawOrderInput {
  items: Array<{
    productId: string
    qty: number
    extras?: string[]
    options?: Record<string, string>
  }>
  orderType?: string
  tableNo?: string
  address?: string
  note?: string
  packing?: boolean
  pickup?: boolean
  customerPhone?: string
  customerName?: string
}

// 聚合页（[vertical]/page.tsx）feed 的店铺输入投影：聚合查询 listVerifiedShops 跨垂直通用，
// 垂直只覆盖 card 投影（卡片显示什么）。Shop 无垂直子类型字段（无「菜系/服务类」），
// 故本期不做 categories 分组（YAGNI，留待阶段3为 Shop 加子类型字段）。
export interface AggShopInput {
  id: string
  slug: string
  name: string
  vertical: Vertical
  currency: string
  open: boolean
  featured: boolean
  /** 垂直 config（差异化卡读：food 简介 / moto 服务范围等）；JsonValue 强转而入 */
  config?: Record<string, unknown> | null
}

// 聚合卡片投影结果：聚合页按此字段渲染（统一卡片模型）。
export interface AggCard {
  title: string
  slug: string
  vertical: Vertical
  open: boolean
  currency: string
  /** 徽章文案（本地化；可选） */
  badge?: string
  /** 副信息（如品类/服务范围；可选） */
  subtitle?: string
}

// 聚合差异扩展点：加垂直需差异化卡片（不只泛化模板）时 implement card；留空由聚合页兜底通用 defaultAggCard。
export interface VerticalAggregation<V extends Vertical = Vertical> {
  vertical: V
  card?(shop: AggShopInput, ctx: { locale: string }): AggCard
}

export interface VerticalModule<V extends Vertical = Vertical> {
  /** 该模块所属垂直 */
  vertical: V
  /** 顾客单店根入口：'menu' 渲染菜单页（默认）；其它字符串（如 moto 的 'lookup'）把根重定向到该子页。
   *  新垂直声明即生效，根入口不再是「非 FOOD 一律跳 /lookup」的硬编码死路。 */
  customerEntry?: 'menu' | string
  /** 建单成功后的垂直副作用（food 发新单提醒 / 未来垂直建档、发通知等）。由 createOrder 事务后调用。
   *  垂直决定要写什么（提醒模板/子表/外部通知），只把已落库的 order + shop 交回。 */
  onOrderCreated?(ctx: { order: Order; shop: Shop; input: RawOrderInput }): Promise<void>
  /** 聚合页差异注入（重构点 #4）：默认 undefined，由聚合页兜底通用模板 */
  aggregation?: VerticalAggregation<V>
}

// FOOD 建单副作用：事务后发「新单提醒」（老板一键复制发 Zalo）。原内联在 createOrder，挪此为垂直声明。
// 数据尽量从已落库的 order 读（真实持久化值），input 供未来垂直参考。
async function foodOnOrderCreated({ order, shop }: { order: Order; shop: Shop }): Promise<void> {
  const cfg = (order.config ?? {}) as Record<string, unknown>
  const items = (order.items as StoredOrderItem[] | null) ?? []
  await prisma.reminder.create({
    data: {
      shopId: shop.id,
      orderId: order.id,
      templateKey: 'FOOD_NEW_ORDER',
      dueAt: order.createdAt,
      status: 'PENDING',
      payload: {
        displayNo: order.displayNo,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        // total 为 Prisma Decimal，转 number 存入 payload（原 createOrder 传的是计算 number）
        total: Number(order.total),
        orderType: cfg.orderType ?? null,
        tableNo: cfg.tableNo ?? null,
        items: items.map((it) => ({ name: it.name, qty: it.qty })),
      },
    },
  })
}

function noopModule<V extends Vertical>(vertical: V): VerticalModule<V> {
  return { vertical }
}

// 聚合卡共用投影：badge=营业态（页面映射 open/closed），差异化卡需保留（否则页面误判为 closed）
function aggBase(shop: AggShopInput): AggCard {
  return {
    title: shop.name,
    slug: shop.slug,
    vertical: shop.vertical,
    open: shop.open,
    currency: shop.currency,
    badge: shop.open ? 'open' : 'closed',
  }
}

// FOOD 聚合卡：subtitle = 店简介（config.description，截断；空则不显示）
function foodAggregation(): VerticalAggregation<'FOOD'> {
  return {
    vertical: 'FOOD',
    card(shop) {
      const cfg = (shop.config ?? {}) as Record<string, unknown>
      const desc = typeof cfg.description === 'string' ? cfg.description : ''
      return { ...aggBase(shop), subtitle: desc ? desc.slice(0, 40) : undefined }
    },
  }
}

// MOTO 聚合卡：subtitle = 服务范围（config.presets 的 category 去重汇总，如「维修 · 保养」）
function motoAggregation(): VerticalAggregation<'MOTO'> {
  return {
    vertical: 'MOTO',
    card(shop) {
      const cfg = (shop.config ?? {}) as Record<string, unknown>
      const presets = Array.isArray(cfg.presets)
        ? (cfg.presets as Array<{ category?: string }>)
        : []
      const cats = [...new Set(presets.map((p) => p.category).filter(Boolean))] as string[]
      return { ...aggBase(shop), subtitle: cats.length ? cats.slice(0, 2).join(' · ') : undefined }
    },
  }
}

const MODULES: Record<Vertical, VerticalModule> = {
  FOOD: { vertical: 'FOOD', customerEntry: 'menu', onOrderCreated: foodOnOrderCreated, aggregation: foodAggregation() },
  MOTO: { vertical: 'MOTO', customerEntry: 'lookup', aggregation: motoAggregation() },
  SALON: noopModule('SALON'),
  PET: noopModule('PET'),
  LAUNDRY: noopModule('LAUNDRY'),
}

/** 取某垂直的域模块（无注入时返回纯 no-op 默认） */
export function getVerticalModule<V extends Vertical>(vertical: V): VerticalModule<V> {
  return MODULES[vertical] as VerticalModule<V>
}
