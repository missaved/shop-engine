// 租户隔离：shopId 一律服务端派生，客户端永不传 shopId
// 约定：URL 形如 /s/[shopSlug]/...，页面/接口用 getShopBySlug 加载租户，
// 之后所有查询 where 必须带 shop.shopId，杜绝跨店访问
import { prisma } from './prisma'
import { notFound } from 'next/navigation'

// 按 slug 取店铺，找不到即 404
export async function getShopBySlug(slug: string) {
  const shop = await prisma.shop.findUnique({
    where: { slug },
  })
  if (!shop) notFound()
  return shop
}

// 校验某行确属当前租户，防止越权读他人店铺数据
export function assertShopOwned(shopId: string, row: { shopId: string } | null): void {
  if (!row || row.shopId !== shopId) notFound()
}
