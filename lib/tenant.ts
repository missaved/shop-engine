// 租户隔离：shopId 一律服务端派生，客户端永不传 shopId
// 约定：URL 为「多垂直三态」/ {locale}/{city}/{vertical}/{slug}[/{sub}]
//       ① 垂直内单店（/zh/hcm/food/foo）② 垂直聚合（/zh/hcm/food）③ 城市门户（/zh/hcm）
//       页面/接口用 getShopBySlug 加载租户（expectVertical/expectCity 校验垂直与城市段），
// 之后所有查询 where 必须带 shop.shopId，杜绝跨店访问
import { prisma } from './prisma'
import { notFound } from 'next/navigation'
import { getSetting } from './platform-settings'
import type { Vertical } from './vertical'

// 顾客端店铺不可用错误（2026-08-29 用户拍板）：
// - reason='maintenance'：维护模式全拦（含查单）——维护开启时所有顾客端访问显示维护页
// - reason='not_approved'：入驻审核开启时，未通过审核的店铺拒绝访问（带驳回原因）
// 页面层 catch 后用 ShopUnavailableView 渲染多语提示；server action 场景 message 即用户可读文案。
export class ShopUnavailableError extends Error {
  readonly reason: 'maintenance' | 'not_approved'
  readonly rejectReason: string | null

  constructor(reason: 'maintenance' | 'not_approved', rejectReason: string | null = null) {
    super(reason === 'maintenance' ? '店铺维护中，请稍后再来' : '店铺暂未开放')
    this.name = 'ShopUnavailableError'
    this.reason = reason
    this.rejectReason = rejectReason
  }
}

// 按 slug 取店铺，找不到即 404
// 顾客端统一拦截点：维护模式全拦（含查单）+ 入驻审核（开时 approved=false 拒绝）。
// 8 个调用点（菜单/查单/下单 action/推荐菜）全为顾客端；boss/admin 后台（dashboard）不经过本函数，天然放行。
export async function getShopBySlug(slug: string, options?: { expectVertical?: Vertical; expectCity?: string }) {
  const shop = await prisma.shop.findUnique({
    where: { slug },
  })
  if (!shop) notFound()
  // 多垂直门：URL 垂直段与 shop 实际垂直不符 → 404（收敛各页散落的 assertMotoShop / if vertical!=='MOTO'）
  if (options?.expectVertical && shop.vertical !== options.expectVertical) notFound()
  // 多城市门：URL 城市段与 shop.city 不符 → 404（防跨城窜店；仅页面/URL 场景传入，server action 只按 slug/shopId 操作不传，保持宽容）
  if (options?.expectCity && shop.city !== options.expectCity) notFound()
  const [maintenance, onboarding] = await Promise.all([
    getSetting<{ mode?: boolean }>('maintenance'),
    getSetting<{ reviewRequired?: boolean }>('onboarding'),
  ])
  if (maintenance?.mode) throw new ShopUnavailableError('maintenance')
  if (onboarding?.reviewRequired && !shop.approved) {
    throw new ShopUnavailableError('not_approved', shop.rejectReason)
  }
  return shop
}

// 校验某行确属当前租户，防止越权读他人店铺数据；通过则返回非空行（供调用侧收窄类型）
export function assertShopOwned<T extends { shopId: string }>(
  shopId: string,
  row: T | null,
): T {
  if (!row || row.shopId !== shopId) notFound()
  return row
}
