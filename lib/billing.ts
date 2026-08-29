// 订阅/到期判断（单点复用：客户菜单 / 老板后台 / 中台三处共用，杜绝散落重复判断）
// 订阅状态 = subscribedUntil 与 now 比较推导，无状态枚举；null = 无期限
// 「能否对外营业」三态统一：open（老板打烊）/ isShopExpired（订阅到期）/ platformSuspended（平台停用）三个独立维度
import { getSetting } from '@/lib/platform-settings'

// 订阅是否已到期（2026-08-29 审计补接线：读 billing 配置）
// - graceDays：已到期但在宽限天数内 → 不视为到期（宽限续用，默认 0 维持现状）
// - expiryPolicy：'downgrade' → 宽限过后不锁死（降档续用；plan 降级动作本期预留）；
//   'lock'/'freeze'/未配置 → 宽限过后锁死（默认现状）
// 无 billing 配置时行为与旧版完全一致（向后兼容）
export async function isShopExpired(shop: {
  subscribedUntil: Date | null
}): Promise<boolean> {
  if (!shop.subscribedUntil) return false
  const expiredAt = shop.subscribedUntil.getTime()
  if (expiredAt >= Date.now()) return false
  const billing = (await getSetting<{ graceDays?: number; expiryPolicy?: string }>('billing')) ?? {}
  const graceMs = (billing.graceDays ?? 0) * 24 * 60 * 60 * 1000
  if (Date.now() <= expiredAt + graceMs) return false // 宽限期内仍可用
  if (billing.expiryPolicy === 'downgrade') return false // 降级策略：宽限后不锁死
  return true
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
