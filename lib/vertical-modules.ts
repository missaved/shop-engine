// 垂直差异注入点（扩展接口）。只 import 纯层 vertical.ts + prisma 类型（type-only），
// 不被 tenant.ts 反向 import（防循环）。「加垂直」= 这里注册一个模块，其余代码零改。
// 分两类注入：① 订单域 hook（validateOrderInput/onOrderCreated/reminderMeta，默认 no-op，YAGNI 用法）；
// ② 聚合页差异（aggregation，见重构点 #4）——加垂直聚合页零改，需差异化卡片时在此实现。
import type { Order, Shop, Vertical } from '@/generated/prisma/client'

// 建单输入（跨垂直的公共子集；细化的垂直校验/副作用在 hook 内部展开）
export interface RawOrderInput {
  items: Array<{
    productId: string
    qty: number
    extras?: Record<string, number>
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
  /** 返 null = 通过；返字符串 = 该垂直自定义的校验失败信息 */
  validateOrderInput?(input: RawOrderInput): string | null
  /** 建单成功后的垂直副作用（food 建提醒通知 / moto 建档 Vehicle 等） */
  onOrderCreated?(ctx: { order: Order; shop: Shop; input: RawOrderInput }): Promise<void>
  /** 提醒模板的垂直投影（labelKey/style），无此模板返 null */
  reminderMeta?(key: string): { labelKey: string; style: string } | null
  /** 聚合页差异注入（重构点 #4）：默认 undefined，由聚合页兜底通用模板 */
  aggregation?: VerticalAggregation<V>
}

function noopModule<V extends Vertical>(vertical: V): VerticalModule<V> {
  return { vertical }
}

const MODULES: Record<Vertical, VerticalModule> = {
  FOOD: noopModule('FOOD'),
  MOTO: noopModule('MOTO'),
  SALON: noopModule('SALON'),
  PET: noopModule('PET'),
  LAUNDRY: noopModule('LAUNDRY'),
}

/** 取某垂直的域模块（无注入时返回纯 no-op 默认） */
export function getVerticalModule<V extends Vertical>(vertical: V): VerticalModule<V> {
  return MODULES[vertical] as VerticalModule<V>
}
