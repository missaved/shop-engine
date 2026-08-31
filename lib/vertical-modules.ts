// 垂直差异注入点（扩展接口）。只 import 纯层 vertical.ts + prisma 类型（type-only），
// 不被 tenant.ts 反向 import（防循环）。「加垂直」= 这里注册一个模块，其余代码零改。
// 只预留 3 个可选 hook，默认 no-op；出现第四个需求再扩展（YAGNI）。
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

export interface VerticalOrderDomain<V extends Vertical = Vertical> {
  /** 该模块所属垂直 */
  vertical: V
  /** 返 null = 通过；返字符串 = 该垂直自定义的校验失败信息 */
  validateOrderInput?(input: RawOrderInput): string | null
  /** 建单成功后的垂直副作用（food 建提醒通知 / moto 建档 Vehicle 等） */
  onOrderCreated?(ctx: { order: Order; shop: Shop; input: RawOrderInput }): Promise<void>
  /** 提醒模板的垂直投影（labelKey/style），无此模板返 null */
  reminderMeta?(key: string): { labelKey: string; style: string } | null
}

function noopModule<V extends Vertical>(vertical: V): VerticalOrderDomain<V> {
  return { vertical }
}

const MODULES: Record<Vertical, VerticalOrderDomain> = {
  FOOD: noopModule('FOOD'),
  MOTO: noopModule('MOTO'),
  SALON: noopModule('SALON'),
  PET: noopModule('PET'),
  LAUNDRY: noopModule('LAUNDRY'),
}

/** 取某垂直的域模块（无注入时返回纯 no-op 默认） */
export function getVerticalModule<V extends Vertical>(vertical: V): VerticalOrderDomain<V> {
  return MODULES[vertical] as VerticalOrderDomain<V>
}
