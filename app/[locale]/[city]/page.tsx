// 城市门户页：/{locale}/{city}。该城市的垂直分类 + 各垂直真店列表（沉浸大图式一级门户）。
// city 已为数据维度（Shop.city）；按城市段聚合（listVerifiedShops(vertical, city)），加垂直零改。
// 2026-09-01 #7 沉浸大图版：与聚合页统一——城市风景 hero + 城市名 + 各垂直区块店列表。
// 与 /{locale}/{city}/{vertical}（单垂直聚合页）、/{locale}/{city}/{vertical}/{slug}（单店）按段数区分，不冲突。
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { parseCitySlug, cityMeta } from '@/lib/city'
import { VERTICALS } from '@/lib/vertical'
import { verticalUrl } from '@/lib/urls'
import { getVerticalModule } from '@/lib/vertical-modules'
import { listVerifiedShops, defaultAggCard } from '@/lib/aggs'
import { getSetting } from '@/lib/platform-settings'
import type { BillingPolicy } from '@/lib/billing'
import { ShopCard } from '@/components/shop-card'
import { CitySwitcher } from '@/components/city-switcher'
import { LocaleSwitcher } from '@/components/locale-switcher'

// 垂直 → 本地授权缩略图（分类横条/区块标题用；与聚合页一致的 MiniMax 生成图）
const VERTICAL_IMG: Record<string, string> = {
  FOOD: '/vertical/food.jpg',
  MOTO: '/vertical/moto.jpg',
  SALON: '/vertical/salon.jpg',
  PET: '/vertical/pet.jpg',
  LAUNDRY: '/vertical/laundry.jpg',
}

// 本页读 DB（各垂直该城市已验证店铺 + shopCount），保持动态渲染；否则 build 期静态预渲染会把当时的店铺快照固化，seed/新店上线后看不到
export const dynamic = 'force-dynamic'

// 审计 12 轮 V：门户页差异化 SEO 元数据。title/description 用 locale 城市名 + 站点 tagline；
// canonical 相对路径（生产 Next 自动按 VERCEL_URL 拼绝对）；og 图由 app/opengraph-image.png convention 全站提供。
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; city: string }>
}): Promise<Metadata> {
  const { locale, city: cityParam } = await params
  const city = parseCitySlug(cityParam)
  if (!city) return {} // 非法城市 → 用 layout 兜底（页面本体自会 404）
  const tc = await getTranslations('city')
  const home = await getTranslations('home')
  const title = `${tc(city)} · spotnear`
  return {
    title,
    description: `${tc(city)} · ${home('tagline')}`,
    alternates: { canonical: `/${locale}/${cityParam}` },
  }
}

export default async function CityHomePage({
  params,
}: {
  params: Promise<{ locale: string; city: string }>
}) {
  const { city: cityParam, locale } = await params
  const city = parseCitySlug(cityParam)
  if (!city) notFound()
  const meta = cityMeta(city)
  // P3-S：到期判定与 isShopExpired 一致，一次取中台 billing 配置注入 ctx（避免每垂直重复查 DB）
  const billing = await getSetting<BillingPolicy>('billing')
  const ta = await getTranslations('admin')
  const td = await getTranslations('dashboard')
  const tc = await getTranslations('city') // 城市名 6 语

  // 并行拉各垂直该城市已验证店铺 + 卡片投影（垂直差异 aggregation.card，未实现走通用 defaultAggCard）
  const feeds = await Promise.all(
    VERTICALS.map(async (vertical) => {
      const cardFn = getVerticalModule(vertical).aggregation?.card ?? defaultAggCard
      const shops = await listVerifiedShops(vertical, city)
      return { vertical, cardFn, shops }
    }),
  )

  return (
    <main className="flex flex-1 flex-col bg-[#111]">
      {/* 沉浸大图 Hero：城市风景铺满 */}
      <section className="relative flex h-[220px] flex-col justify-end overflow-hidden px-5 pb-6 pt-5">
        <Image
          src="/hero/city.jpg"
          alt=""
          fill
          sizes="100vw"
          loading="eager"
          fetchPriority="high"
          className="object-cover object-[center_58%]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />

        {/* 顶部：城市 + 语言切换（半透明 pill） */}
        <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-full bg-white/12 px-3 py-1.5 backdrop-blur-md">
            <span className="text-sm leading-none">📍</span>
            <CitySwitcher className="border-0 bg-transparent pr-0 text-[12.5px] font-medium text-white outline-none [&>option]:text-zinc-900" />
            <span className="text-[12.5px] font-medium text-white/90">{tc(city)}</span>
          </div>
          <div className="flex items-center rounded-full bg-white/12 px-1.5 py-1 backdrop-blur-md">
            <LocaleSwitcher />
          </div>
        </div>

        {/* 底部：城市名 + meta */}
        <div className="relative z-10 flex flex-col">
          <h1 className="text-[27px] font-extrabold leading-[1.1] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]">
            {tc(city)}
          </h1>
          <p className="mt-1.5 text-[13px] text-white/90">
            {meta.flag} {meta.nameEn} · {meta.country}
          </p>
        </div>
      </section>

      {/* 各垂直分类区：该城市真店列表（沉浸深色 body） */}
      <section className="rounded-t-[26px] bg-[#181820] px-5 pb-8 pt-6">
        {/* 顶部分类导航横条：切换即跳对应垂直页（原生滚动条已隐藏） */}
        <div className="mb-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {VERTICALS.map((v) => {
            const labelKey = 'vertical' + v[0] + v.slice(1).toLowerCase()
            return (
              <Link
                key={v}
                href={verticalUrl(v, city)}
                className="flex flex-none items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-[#1f1f28] py-2 pl-2 pr-3 text-[13px] font-semibold text-[#b6b6be] transition-colors hover:bg-[#26262f] hover:text-white"
              >
                <span
                  className="h-6 w-6 flex-none rounded-[7px] bg-cover bg-center"
                  style={{ backgroundImage: `url('${VERTICAL_IMG[v]}')` }}
                />
                {ta(labelKey)}
              </Link>
            )
          })}
        </div>

        {feeds.map(({ vertical, cardFn, shops }) => {
          const labelKey = 'vertical' + vertical[0] + vertical.slice(1).toLowerCase()
          return (
            <div key={vertical} className="mb-6 last:mb-0">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
                  <span
                    className="h-[22px] w-[22px] flex-none rounded-md bg-cover bg-center"
                    style={{ backgroundImage: `url('${VERTICAL_IMG[vertical]}')` }}
                  />
                  {ta(labelKey)}
                </h2>
                <span className="text-[11px] text-zinc-500">
                  {shops.length > 0 ? tc('shopCount', { n: shops.length }) : ''}
                </span>
              </div>
              {shops.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/5 py-8 text-center">
                  <span className="text-lg text-zinc-500">{ta('comingSoon')}</span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {shops.map((s) => {
                    const card = cardFn(s, { locale, billing })
                    return (
                      <ShopCard
                        key={card.slug}
                        card={card}
                        vertical={vertical}
                        city={city}
                        image={card.image ?? VERTICAL_IMG[vertical]}
                        openLabel={td('open')}
                        closedLabel={td('closed')}
                        suspendedLabel={td('suspended')}
                        expiredLabel={td('expired')}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </main>
  )
}
