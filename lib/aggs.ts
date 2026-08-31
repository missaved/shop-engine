// 垂直聚合查询服务：跨垂直通用的「列出某垂直已验证店铺」+ 默认卡片投影。
// 聚合页（[vertical]/page.tsx）用它 + vertical-modules 的 aggregation.card（可覆盖）驱动渲染，
// 加垂直只加 vertical.ts 一项 + vertical-modules 一个模块，本文件零改（重构点 #4）。
import { prisma } from '@/lib/prisma'
import type { Vertical } from '@/lib/vertical'
import type { CitySlug } from '@/lib/city'
import type { AggCard, AggShopInput } from '@/lib/vertical-modules'

// 聚合 feed 的店铺投影（子集，够卡片渲染用；与 vertical-modules 的 AggShopInput 兼容）
export interface ShopPublic extends AggShopInput {}

// 列出某垂直已验证店铺：approved（入驻审核通过）+ 推荐位置顶（featured，平台推广，聚合排序用）。
// 不强制 open/platformSuspended/到期——这些属「店是否可用」而非「是否该列」，由卡片标识而非过滤（避免误藏已播报店）。
export async function listVerifiedShops(vertical: Vertical, city?: CitySlug): Promise<ShopPublic[]> {
  const shops = await prisma.shop.findMany({
    // city 可选：传了按城市过滤（阶段3 数据维度）；缺省不筛（门户/通用场景）
    where: { vertical, approved: true, ...(city ? { city } : {}) },
    orderBy: [{ featured: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      vertical: true,
      currency: true,
      open: true,
      featured: true,
    },
  })
  return shops
}

// 默认卡片投影（垂直未实现 aggregation.card 时兜底）：title=店名，badge=营业态。
// 差异化卡片（如 food 显菜单首图 / moto 显服务范围）届时在 vertical-modules 的 aggregation.card 覆盖。
export function defaultAggCard(shop: ShopPublic, _ctx: { locale: string }): AggCard {
  return {
    title: shop.name,
    slug: shop.slug,
    vertical: shop.vertical,
    open: shop.open,
    currency: shop.currency,
    badge: shop.open ? 'open' : 'closed', // 由页面侧映射为「营业中/已打烊」（i18n 在聚合页做）
  }
}
