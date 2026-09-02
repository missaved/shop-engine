import { notFound } from 'next/navigation'
import { getShopBySlug, ShopUnavailableError } from '@/lib/tenant'
import { ShopUnavailableView } from '@/components/shop/shop-unavailable'
import { parseVerticalSlug } from '@/lib/vertical'
import { parseCitySlug } from '@/lib/city'
import { LaundrySelfOrder } from '@/components/laundry/laundry-selforder'

export default async function LaundrySelfOrderPage({ params }: { params: Promise<{ locale: string; city: string; vertical: string; slug: string }> }) {
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
  const cfg = (shop.config as { laundryRates?: { itemRates?: { name: string; price: number }[]; kgRate?: number; shoeBase?: Record<string, number> } } | null) ?? {}
  return <LaundrySelfOrder slug={slug} currency={shop.currency} itemRates={cfg.laundryRates?.itemRates ?? []} />
}
