// 计价/加菜共用 helper（非 'use server'）
// 背景：server action 模块（'use server'）只能导出异步函数或类型，同步 helper 必须在普通模块里。
// 本模块被 lib/actions.ts（老板侧）与 lib/shop-actions.ts（客户侧）共同 import，计价逻辑只写一份。
// 纯服务端模块，禁止被任何 client 组件 import（内部使用 prisma）。
import { prisma } from '@/lib/prisma'

// 单商品数量上限（餐饮单合理值，防 qty 传超大数致金额溢出）
export const MAX_QTY_PER_ITEM = 99

// 客户端购物车项（服务端计价，不信任客户端传价）
export type CartItem = {
  productId: string
  qty: number
  extras?: string[]
  // 规格选择：规格组名 -> 选中选项名
  options?: Record<string, string>
}

// 订单 items 快照结构（含价格/加料/规格/套餐，服务端计价后落库）
// combo 为套餐组成（createOrder 原快照含，缺了会在查单/老板端套餐展示静默回归）
export type StoredOrderItem = {
  productId?: string
  name: string
  qty: number
  price: number | string
  extras?: { name: string; price: number | string }[]
  options?: { group: string; name: string; price: number | string }[]
  combo?: { name: string; qty: number }[]
}

// 单行商品小计：商品价 + 加料价 + 规格价，乘以数量
export function itemSubtotal(it: StoredOrderItem): number {
  const extrasSum = (it.extras ?? []).reduce((s, e) => s + Number(e.price), 0)
  const optionsSum = (it.options ?? []).reduce((s, o) => s + Number(o.price), 0)
  return (Number(it.price) + extrasSum + optionsSum) * Number(it.qty)
}

// 客户端购物车项 → 按商品聚合（M7/M8 安全校验，两端共用）
// - 逐行过滤无效 qty（0 / 非数 / 超单行上限）
// - 运行时类型校验（防御不可信客户端输入）：
//   extras 须字符串数组且 ≤20 项（防字符串子串匹配污染加料）；options 须普通对象
// - 聚合后单商品数量 > MAX_QTY_PER_ITEM → 拒绝（多行累加绕过逐行上限，如 100 行 × 99）
// 返回 error 表示整体非法，调用方直接拒绝（不部分生效）
export function aggregateCartItems(input: CartItem[]): {
  qtyMap: Map<string, number>
  extrasMap: Map<string, string[]>
  optionsMap: Map<string, Record<string, string>>
  error?: 'invalid' | 'overflow'
} {
  const qtyMap = new Map<string, number>()
  const extrasMap = new Map<string, string[]>()
  const optionsMap = new Map<string, Record<string, string>>()
  for (const it of input ?? []) {
    if (!it || typeof it !== 'object') continue
    const pid = it.productId
    if (typeof pid !== 'string' || !pid) continue
    const q = Math.trunc(Number(it.qty))
    if (!Number.isFinite(q) || q <= 0 || q > MAX_QTY_PER_ITEM) continue
    const extrasOk =
      it.extras === undefined ||
      it.extras === null ||
      (Array.isArray(it.extras) &&
        it.extras.length <= 20 &&
        it.extras.every((x) => typeof x === 'string'))
    const optionsOk =
      it.options === undefined ||
      it.options === null ||
      (typeof it.options === 'object' && !Array.isArray(it.options))
    if (!extrasOk || !optionsOk) {
      return { qtyMap: new Map(), extrasMap: new Map(), optionsMap: new Map(), error: 'invalid' }
    }
    const prev = qtyMap.get(pid) ?? 0
    if (prev + q > MAX_QTY_PER_ITEM) {
      return { qtyMap: new Map(), extrasMap: new Map(), optionsMap: new Map(), error: 'overflow' }
    }
    qtyMap.set(pid, prev + q)
    if (Array.isArray(it.extras) && it.extras.length > 0) extrasMap.set(pid, it.extras)
    if (it.options && typeof it.options === 'object' && !Array.isArray(it.options)) {
      optionsMap.set(pid, it.options as Record<string, string>)
    }
  }
  return { qtyMap, extrasMap, optionsMap }
}

// 服务端计价：按聚合的 qtyMap/extrasMap/optionsMap 从商品表查价（不信任客户端传价），
// 返回落库快照行 + subtotal + canAddOnById（READY 阶段「按商品属性」加菜校验用）。
// 找不到 / 售罄 / 越权商品 → 抛错（调用方转用户文案）。
export async function priceCartItems(params: {
  shopId: string
  qtyMap: Map<string, number>
  extrasMap: Map<string, string[]>
  optionsMap: Map<string, Record<string, string>>
}): Promise<{
  items: StoredOrderItem[]
  subtotal: number
  canAddOnById: Map<string, boolean>
}> {
  const { shopId, qtyMap, extrasMap, optionsMap } = params
  const products = await prisma.product.findMany({
    where: { id: { in: [...qtyMap.keys()] }, shopId, active: true },
  })
  // 找到的商品数 ≠ 请求的商品数 → 有售罄/越权/不存在的项
  if (products.length !== qtyMap.size) throw new Error('部分商品已售罄或不存在')

  const canAddOnById = new Map<string, boolean>()
  const items: StoredOrderItem[] = products.map((p) => {
    const cfg = p.config as {
      extras?: { name: string; price: number }[]
      optionGroups?: { name: string; options: { name: string; price?: number }[] }[]
      combo?: { name: string; qty: number }[]
      canAddOn?: boolean
    } | null
    // 默认可追加（用户拍板：现有/新建商品默认 true，老板手动收窄）
    canAddOnById.set(p.id, cfg?.canAddOn ?? true)
    const chosenNames = extrasMap.get(p.id) ?? []
    const extras = (cfg?.extras ?? [])
      .filter((ex) => chosenNames.includes(ex.name))
      .map((ex) => ({ name: ex.name, price: Number(ex.price) }))
    // 规格：按 optionGroups 查选中选项的加价；未选中/非法选项丢弃
    const chosenOptions = optionsMap.get(p.id) ?? {}
    const options = (cfg?.optionGroups ?? [])
      .map((g) => {
        const opt = g.options.find((o) => o.name === chosenOptions[g.name])
        return opt ? { group: g.name, name: opt.name, price: Number(opt.price ?? 0) } : null
      })
      .filter((o): o is { group: string; name: string; price: number } => o !== null)
    return {
      productId: p.id,
      name: p.name,
      qty: qtyMap.get(p.id)!,
      price: Number(p.price),
      extras,
      options,
      combo: (cfg?.combo ?? []).map((c) => ({ name: c.name, qty: c.qty })),
    }
  })
  const subtotal = items.reduce((sum, it) => sum + itemSubtotal(it), 0)
  return { items, subtotal, canAddOnById }
}
