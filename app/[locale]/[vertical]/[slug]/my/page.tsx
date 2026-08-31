// M6a 查车页：/{vertical}/{slug}/my（登录客户），requireCustomer 拦截未登录 → 跳 lookup
import { notFound } from 'next/navigation'
import { getShopBySlug, ShopUnavailableError } from '@/lib/tenant'
import { ShopUnavailableView } from '@/components/shop/shop-unavailable'
import { requireCustomer } from '@/lib/dal'
import { getTranslations } from 'next-intl/server'
import { parseVerticalSlug } from '@/lib/vertical'
import { CustomerVehicles } from '@/components/moto/customer-vehicles'

export default async function CustomerMyPage({
  params,
}: {
  params: Promise<{ locale: string; vertical: string; slug: string }>
}) {
  const { slug, vertical: verticalParam } = await params
  const vertical = parseVerticalSlug(verticalParam)
  if (!vertical) notFound()
  // 客户守卫：未登录 → 重定向该店 lookup
  await requireCustomer(slug, vertical)
  let shop: Awaited<ReturnType<typeof getShopBySlug>>
  try {
    shop = await getShopBySlug(slug, { expectVertical: vertical })
  } catch (e) {
    if (e instanceof ShopUnavailableError) {
      return (
        <ShopUnavailableView reason={e.reason} rejectReason={e.rejectReason} />
      )
    }
    throw e
  }
  if (shop.vertical !== 'MOTO') {
    const t = await getTranslations('customer')
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-4">
        <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {t('notMoto')}
        </p>
      </main>
    )
  }
  return (
    <CustomerVehicles
      slug={slug}
      currency={shop.currency}
      shopName={shop.name}
    />
  )
}
