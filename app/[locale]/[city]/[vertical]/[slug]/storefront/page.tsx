import { notFound } from 'next/navigation'
import { getShopBySlug, ShopUnavailableError } from '@/lib/tenant'
import { ShopUnavailableView } from '@/components/shop/shop-unavailable'
import { parseVerticalSlug } from '@/lib/vertical'
import { parseCitySlug } from '@/lib/city'
import { LaundryStorefront } from '@/components/laundry/laundry-storefront'

export default async function LaundryStorefrontPage({ params }: { params: Promise<{ locale: string; city: string; vertical: string; slug: string }> }) {
  const { slug, city: cityParam, vertical: verticalParam } = await params
  const vertical = parseVerticalSlug(verticalParam)
  if (vertical !== 'LAUNDRY') notFound()
  const city = parseCitySlug(cityParam)
  if (!city) notFound()
  let shop
  try {
    shop = await getShopBySlug(slug, { expectVertical: vertical, expectCity: city })
  } catch (e) {
    if (e instanceof ShopUnavailableError) return <ShopUnavailableView reason={e.reason} rejectReason={e.rejectReason} />
    throw e
  }
  return (
    <LaundryStorefront
      slug={slug}
      currency={shop.currency}
      shopName={shop.name}
      address={shop.address}
      city={city}
    />
  )
}
