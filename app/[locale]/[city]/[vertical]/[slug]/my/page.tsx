// M6a 查车页：/{vertical}/{slug}/my（登录客户），requireCustomer 拦截未登录 → 跳 lookup
import { notFound } from 'next/navigation'
import { getShopBySlug, ShopUnavailableError } from '@/lib/tenant'
import { ShopUnavailableView } from '@/components/shop/shop-unavailable'
import { requireCustomer } from '@/lib/dal'
import { parseVerticalSlug } from '@/lib/vertical'
import { parseCitySlug } from '@/lib/city'
import { CustomerVehicles } from '@/components/moto/customer-vehicles'
import { LaundryCustomer } from '@/components/laundry/laundry-customer'

export default async function CustomerMyPage({
  params,
}: {
  params: Promise<{ locale: string; city: string; vertical: string; slug: string }>
}) {
  const { slug, city: cityParam, vertical: verticalParam } = await params
  const vertical = parseVerticalSlug(verticalParam)
  if (!vertical) notFound()
  const city = parseCitySlug(cityParam)
  if (!city) notFound()
  // 客户守卫：未登录 → 重定向该店 lookup
  await requireCustomer(slug, vertical, city)
  let shop: Awaited<ReturnType<typeof getShopBySlug>>
  try {
    shop = await getShopBySlug(slug, { expectVertical: vertical, expectCity: city })
  } catch (e) {
    if (e instanceof ShopUnavailableError) {
      return (
        <ShopUnavailableView reason={e.reason} rejectReason={e.rejectReason} />
      )
    }
    throw e
  }
  // LAUNDRY 顾客侧：登录顾客看本店储值/卡/洗衣订单（与 MOTO CustomerVehicles 分流）
  if (vertical === 'LAUNDRY') {
    return <LaundryCustomer slug={slug} currency={shop.currency} shopName={shop.name} city={city} />
  }
  return (
    <CustomerVehicles
      slug={slug}
      currency={shop.currency}
      shopName={shop.name}
    />
  )
}
