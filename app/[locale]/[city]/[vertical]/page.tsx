// 垂直聚合页（分类页）：/{city}/{vertical}。列举该垂直已验证店铺（沉浸大图式）。
// 「加垂直零改」：核心逻辑跨垂直通用（listVerifiedShops + 模块 aggregation.card），
// 加垂直只加 vertical.ts 一项 + vertical-modules 一个模块，本页零改。
// 段数约定：`/{city}/food` → 本页；`/{city}/food/{slug}` → [vertical]/[slug] 单店页（Next 按段数区分，不冲突）。
// 非合法垂直短码（如老式 /en/{slug}）→ 404。
// 城市段（58 同城式 /{locale}/{city}/{vertical}）：city 已为数据维度（Shop.city），聚合按城市过滤。
// 2026-09-01 #8 沉浸大图版：与聚合页/门户统一——城市风景 hero + 顶部分类导航 + 店铺列表。
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseVerticalSlug, VERTICALS, type Vertical } from '@/lib/vertical'
import { parseCitySlug, cityMeta } from '@/lib/city'
import { Link } from '@/i18n/navigation'
import { shopUrl, verticalUrl } from '@/lib/urls'
import { getVerticalModule } from '@/lib/vertical-modules'
import { listVerifiedShops, defaultAggCard } from '@/lib/aggs'
import { getSetting } from '@/lib/platform-settings'
import type { BillingPolicy } from '@/lib/billing'
import { ShopCard } from '@/components/shop-card'
import { CitySwitcher } from '@/components/city-switcher'
import { LocaleSwitcher } from '@/components/locale-switcher'

// 本页读 DB（某垂直已验证店铺 + 演示店入口），保持动态渲染；否则 build 期静态预渲染固化店铺快照，seed/新店上线后看不到
export const dynamic = 'force-dynamic'

// 垂直 → 本地授权缩略图（分类横条/标题/店铺卡占位；与聚合页/门户一致）
const VERTICAL_IMG: Record<string, string> = {
  FOOD: '/vertical/food.jpg',
  MOTO: '/vertical/moto.jpg',
  SALON: '/vertical/salon.jpg',
  PET: '/vertical/pet.jpg',
  LAUNDRY: '/vertical/laundry.jpg',
}

export default async function VerticalHomePage({
  params,
}: {
  params: Promise<{ locale: string; city: string; vertical: string }>
}) {
  const { vertical: verticalParam, city: cityParam, locale } = await params
  const vertical = parseVerticalSlug(verticalParam)
  if (!vertical) notFound()
  const city = parseCitySlug(cityParam)
  if (!city) notFound()
  const meta = cityMeta(city)

  const t = await getTranslations('admin')
  const td = await getTranslations('dashboard')
  const th = await getTranslations('home')
  const tc = await getTranslations('city') // 城市名 6 语

  // 各垂直演示店（有 → 演示店入口；无 → 只显示 boss/开店；demo 店见 prisma/seed.ts）
  const DEMO_SLUG: Partial<Record<Vertical, string>> = { FOOD: 'demo-pho', MOTO: 'demo-moto', LAUNDRY: 'demolaud' }

  // 垂直差异注入：模块 aggregation.card 可覆盖为差异化卡片；未实现 → 通用 defaultAggCard 兜底
  const cardFn = getVerticalModule(vertical).aggregation?.card ?? defaultAggCard
  // P3-S：到期判定与 isShopExpired 一致，一次取中台 billing 配置注入 ctx（避免每店重复查 DB）
  const billing = await getSetting<BillingPolicy>('billing')
  const shops = await listVerifiedShops(vertical, city)

  // 垂直名：admin.vertical{Food/Moto/Salon/Pet/Laundry}（FOOD→'verticalFood' 等，matched messages）
  const labelKey = 'vertical' + vertical[0] + vertical.slice(1).toLowerCase()

  return (
    <main className="flex flex-1 flex-col bg-[#111]">
      {/* 沉浸大图 Hero：城市风景铺满 */}
      <section className="relative flex h-[220px] flex-col justify-end overflow-hidden px-5 pb-6 pt-5">
        <div
          className="absolute inset-0 bg-cover bg-[center_58%]"
          style={{ backgroundImage: "url('/hero/city.jpg')" }}
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

        {/* 底部：城市名 + 垂直名 + meta */}
        <div className="relative z-10 flex flex-col">
          <h1 className="text-[26px] font-extrabold leading-[1.1] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
            {tc(city)}
          </h1>
          <span className="mt-1 text-[15px] font-bold text-amber-400">{t(labelKey)}</span>
          <p className="mt-1.5 text-[12.5px] text-white/90">
            {meta.flag} {meta.nameEn} · {meta.country}
          </p>
          <p className="mt-0.5 text-[11.5px] text-white/70">{th('tagline')}</p>
        </div>
      </section>

      {/* 沉浸深色 body */}
      <section className="rounded-t-[26px] bg-[#181820] px-5 pb-8 pt-6">
        {/* 顶部分类导航横条：当前垂直高亮，切换即跳对应垂直页（原生滚动条已隐藏） */}
        <div className="mb-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {VERTICALS.map((v) => {
            const vKey = 'vertical' + v[0] + v.slice(1).toLowerCase()
            const active = v === vertical
            return (
              <Link
                key={v}
                href={verticalUrl(v, city)}
                className={`flex flex-none items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-[13px] font-semibold transition-colors ${
                  active
                    ? 'border-white bg-white text-zinc-900'
                    : 'border-white/10 bg-[#1f1f28] text-[#b6b6be] hover:bg-[#26262f] hover:text-white'
                }`}
              >
                <span
                  className="h-6 w-6 flex-none rounded-[7px] bg-cover bg-center"
                  style={{ backgroundImage: `url('${VERTICAL_IMG[v]}')` }}
                />
                {t(vKey)}
              </Link>
            )
          })}
        </div>

        {/* 演示店入口 */}
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-zinc-500">
            {th('shopDemo')}
          </span>
        </div>
        {DEMO_SLUG[vertical] ? (
          <Link
            href={shopUrl({ vertical, slug: DEMO_SLUG[vertical]!, city })}
            className="mb-3 flex items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/5 p-3 transition-colors hover:bg-amber-400/10"
          >
            <span
              className="h-[54px] w-[54px] flex-none rounded-xl bg-cover bg-center"
              style={{ backgroundImage: `url('${VERTICAL_IMG[vertical]}')` }}
            />
            <span className="flex-1">
              <span className="block text-[14px] font-bold text-white">{th('shopDemo')}</span>
            </span>
            <span className="flex-none text-[12px] font-bold text-amber-400">›</span>
          </Link>
        ) : null}

        {/* 老板登录 / 免费开店 */}
        <div className="mb-5 flex gap-2">
          <Link
            href="/login"
            className="flex-1 rounded-xl bg-[#26262f] py-2.5 text-center text-[13px] font-semibold text-[#d6d6dc] transition-colors hover:bg-[#2f2f3a]"
          >
            {th('bossLogin')}
          </Link>
          <Link
            href="/open"
            className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-2.5 text-center text-[13px] font-semibold text-[#1a1203] shadow-md shadow-amber-500/20 transition-transform hover:brightness-105 active:scale-[0.98]"
          >
            {th('freeOpen')}
          </Link>
        </div>

        {/* 该垂直店铺列表 */}
        <div className="mb-3 flex items-center gap-2">
          <span
            className="h-[22px] w-[22px] flex-none rounded-md bg-cover bg-center"
            style={{ backgroundImage: `url('${VERTICAL_IMG[vertical]}')` }}
          />
          <h2 className="text-[15px] font-bold text-white">{t(labelKey)}</h2>
          <span className="ml-auto text-[11px] text-zinc-500">
            {shops.length > 0 ? tc('shopCount', { n: shops.length }) : ''}
          </span>
        </div>
        {shops.length === 0 ? (
          // 空态：该垂直暂无已入驻店铺（保留占位「敬请期待」）
          <div className="flex flex-col items-center gap-1 rounded-2xl border border-white/5 py-8 text-center">
            <span className="text-lg text-zinc-500">{t('comingSoon')}</span>
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
      </section>
    </main>
  )
}
