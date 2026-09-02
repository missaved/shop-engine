// LAUNDRY 组件共享类型（与 lib/laundry-actions 对齐）
import type { Vertical } from '@/lib/vertical'

/** 计价模式（L_MODE 一键切）：公斤 / 按件 / 洗鞋 */
export type LaundryMode = 'kg' | 'item' | 'shoe'

/** 洗鞋款式（shoeBase 定价维度） */
export type ShoeStyle = 'sport' | 'leather' | 'suede'

/** 计价配置（L_RATE，老板在设置里配）：公斤单价 / 按件价 / 洗鞋加成 / 增值项 */
export type LaundryRates = {
  kgRate: number
  itemRates: { name: string; nameZh?: string; nameEn?: string; price: number }[]
  shoeBase: Partial<Record<ShoeStyle, number>>
  shoeAddons: { name: string; price: number }[]
}

/** 老板端 shop 序列化（laundry-dashboard 用） */
export type LaundryShop = {
  id: string
  slug: string
  vertical: Vertical
  name: string
  phone: string | null
  currency: string
  city: string
  open: boolean
  config: {
    laundryRates?: LaundryRates
    laundryTagSeq?: number
    payment?: Record<string, unknown>
    deliveryFee?: number
    extraCategories?: { key: string; name: string; price: number; unit: string }[]
    careSurcharge?: number
  } | null
}

/** 订单列表项（含逾期分级 overdueClass：0=未逾期 1=>3天 2=>7天） */
export type LaundryOrderPlain = {
  id: string
  displayNo: string
  mode: LaundryMode
  tagCode: string | null
  kg: number | null
  itemNames: string[]
  shoeStyle: ShoeStyle | null
  shoeAddonNames: string[]
  status: string
  laundryStatus: string
  total: string
  paidAmount: string
  customerName: string | null
  customerPhone: string | null
  note: string | null
  createdAt: string
  overdueClass: 0 | 1 | 2
  // P2 取送/护理/计件明细
  dispatchType: string | null
  address: string | null
  timeWindow: string | null
  careType: string | null
  itemDetail: { name: string; count: number; mark?: string }[]
  qcNote: string | null
  ticketId: string | null
  claim: { type: string; note?: string; resolution: string; amount: number }[]
}
