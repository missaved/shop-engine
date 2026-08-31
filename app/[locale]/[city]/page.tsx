// 城市门户页：/{locale}/{city}。该城市的垂直分类 + 各垂直真店列表（58 同城式一级门户）。
// city 已为数据维度（Shop.city）；按城市段聚合（listVerifiedShops(vertical, city)），加垂直零改。
// 与 /{locale}/{city}/{vertical}（单垂直聚合页）、/{locale}/{city}/{vertical}/{slug}（单店）按段数区分，不冲突。
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseCitySlug, cityMeta } from '@/lib/city'
import { VERTICALS } from '@/lib/vertical'
import { getVerticalModule } from '@/lib/vertical-modules'
import { listVerifiedShops, defaultAggCard } from '@/lib/aggs'
import { ShopCard } from '@/components/shop-card'
import { CitySwitcher } from '@/components/city-switcher'

export default async function CityHomePage({
  params,
}: {
  params: Promise<{ locale: string; city: string }>
}) {
  const { city: cityParam, locale } = await params
  const city = parseCitySlug(cityParam)
  if (!city) notFound()
  const meta = cityMeta(city)
  const ta = await getTranslations('admin')
  const td = await getTranslations('dashboard')

  // 并行拉各垂直该城市已验证店铺 + 卡片投影（垂直差异 aggregation.card，未实现走通用 defaultAggCard）
  const feeds = await Promise.all(
    VERTICALS.map(async (vertical) => {
      const cardFn = getVerticalModule(vertical).aggregation?.card ?? defaultAggCard
      const shops = await listVerifiedShops(vertical, city)
      return { vertical, cardFn, shops }
    }),
  )

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-bold">{meta.nameEn}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {meta.flag} {meta.name} · {meta.country}
        </p>
        <CitySwitcher />
      </header>

      {/* 各垂直分类区：该城市真店列表（无店显示「敬请期待」空态，stage3 门户雏形） */}
      {feeds.map(({ vertical, cardFn, shops }) => {
        const labelKey = 'vertical' + vertical[0] + vertical.slice(1).toLowerCase()
        return (
          <section key={vertical} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{ta(labelKey)}</h2>
            {shops.length === 0 ? (
              <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
                {ta('comingSoon')}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {shops.map((s) => {
                  const card = cardFn(s, { locale })
                  return (
                    <ShopCard
                      key={card.slug}
                      card={card}
                      vertical={vertical}
                      city={city}
                      openLabel={td('open')}
                      closedLabel={td('closed')}
                    />
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </main>
  )
}
