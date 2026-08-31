// M6a 客户入口（店码落地页）：/{vertical}/{slug}/lookup，公开访问
// 未登录 → 注册/登录（customer provider）+ 匿名查询区块；已登录 → 「我的车辆」链接
import { notFound } from 'next/navigation'
import { getShopBySlug, ShopUnavailableError } from '@/lib/tenant'
import { ShopUnavailableView } from '@/components/shop/shop-unavailable'
import { getCurrentUser } from '@/lib/dal'
import { getTranslations } from 'next-intl/server'
import { parseVerticalSlug } from '@/lib/vertical'
import { parseCitySlug } from '@/lib/city'
import { CustomerLookup } from '@/components/moto/customer-lookup'

export default async function CustomerLookupPage({
  params,
}: {
  params: Promise<{ locale: string; city: string; vertical: string; slug: string }>
}) {
  const { slug, city: cityParam, vertical: verticalParam } = await params
  const vertical = parseVerticalSlug(verticalParam)
  if (!vertical) notFound()
  const city = parseCitySlug(cityParam)
  if (!city) notFound()
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
  // lookup 是摩托店客户入口：非 MOTO 店访问给提示（菜单店有独立菜单页，不提供维修查询）
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
  const user = await getCurrentUser()
  const isLoggedIn = !!user?.customerId
  // 顾客 OAuth 主通道：读 env 判空，把「哪些 provider 已配置」传给登录组件。
  // 未配置的 provider 在组件里渲染 disabled 占位（用户拍板显示占位），而非不渲染。
  const oauthProviders = [
    {
      id: 'google' as const,
      configured: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    },
    {
      id: 'facebook' as const,
      configured:
        !!process.env.FACEBOOK_CLIENT_ID && !!process.env.FACEBOOK_CLIENT_SECRET,
    },
  ]
  return (
    <CustomerLookup
      vertical={shop.vertical}
      slug={slug}
      shopName={shop.name}
      currency={shop.currency}
      isLoggedIn={isLoggedIn}
      oauth={oauthProviders}
    />
  )
}
