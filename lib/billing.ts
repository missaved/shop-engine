// 订阅/到期判断（单点复用：客户菜单 / 老板后台 / 中台三处共用，杜绝散落重复判断）
// 订阅状态 = subscribedUntil 与 now 比较推导，无状态枚举；null = 无期限
// 「能否对外营业」三态统一：open（老板打烊）/ isShopExpired（订阅到期）/ platformSuspended（平台停用）三个独立维度

// 订阅是否已到期：subscribedUntil 存在且 < now
export function isShopExpired(shop: { subscribedUntil: Date | null }): boolean {
  return !!shop.subscribedUntil && shop.subscribedUntil.getTime() < Date.now()
}

// 当前订阅到期时间（供中台/老板显示；null = 无期限）
export function shopAccessUntil(shop: { subscribedUntil: Date | null }): Date | null {
  return shop.subscribedUntil
}

// 加月：Date.setMonth 推进（月末溢出为 JS 默认行为，MVP 接受）
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d)
  r.setMonth(r.getMonth() + months)
  return r
}
