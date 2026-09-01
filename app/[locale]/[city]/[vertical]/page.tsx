// 垂直聚合页（分类页）：/{city}/{vertical}。列举该垂直已验证店铺（重构点 #4，从占位升级为真实列表）。
// 「加垂直零改」：核心逻辑跨垂直通用（listVerifiedShops + 模块 aggregation.card），
// 加垂直只加 vertical.ts 一项 + vertical-modules 一个模块，本页零改。
// 段数约定：`/{city}/food` → 本页；`/{city}/food/{slug}` → [vertical]/[slug] 单店页（Next 按段数区分，不冲突）。
// 非合法垂直短码（如老式 /en/{slug}）→ 404。
// 城市段（58 同城式 /{locale}/{city}/{vertical}）：city 已为数据维度（Shop.city），聚合按城市过滤（阶段3 起步）。
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseVerticalSlug, type Vertical } from '@/lib/vertical'
import { parseCitySlug } from '@/lib/city'
import { Link } from '@/i18n/navigation'
import { shopUrl } from '@/lib/urls'
import { getVerticalModule } from '@/lib/vertical-modules'
import { listVerifiedShops, defaultAggCard } from '@/lib/aggs'
import { getSetting } from '@/lib/platform-settings'
import type { BillingPolicy } from '@/lib/billing'
import { ShopCard } from '@/components/shop-card'
import { CitySwitcher } from '@/components/city-switcher'

// 本页读 DB（某垂直已验证店铺 + 演示店入口），保持动态渲染；否则 build 期静态预渲染固化店铺快照，seed/新店上线后看不到
export const dynamic = 'force-dynamic'

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

  const t = await getTranslations('admin')
  const td = await getTranslations('dashboard')
  const th = await getTranslations('home')
  const tc = await getTranslations('city') // 城市名 6 语

  // 垂直 → 本地授权缩略图（与聚合页/city 页一致；店铺无 config.image 时兜底）
  const VERTICAL_IMG: Record<string, string> = {
    FOOD: '/vertical/food.jpg',
    MOTO: '/vertical/moto.jpg',
    SALON: '/vertical/salon.jpg',
    PET: '/vertical/pet.jpg',
    LAUNDRY: '/vertical/laundry.jpg',
  }

  // 各垂直演示店（有 → 演示店入口；无 → 只显示 boss/开店；demo 店见 prisma/seed.ts）
  const DEMO_SLUG: Partial<Record<Vertical, string>> = { FOOD: 'demo-pho', MOTO: 'demo-moto' }

  // 垂直差异注入：模块 aggregation.card 可覆盖为差异化卡片；未实现 → 通用 defaultAggCard 兜底
  const cardFn = getVerticalModule(vertical).aggregation?.card ?? defaultAggCard
  // P3-S：到期判定与 isShopExpired 一致，一次取中台 billing 配置注入 ctx（避免每店重复查 DB）
  const billing = await getSetting<BillingPolicy>('billing')
  const shops = await listVerifiedShops(vertical, city)

  // 垂直名：admin.vertical{Food/Moto/Salon/Pet/Laundry}（FOOD→'verticalFood' 等，matched messages）
  const labelKey = 'vertical' + vertical[0] + vertical.slice(1).toLowerCase()

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <h1 className="text-center text-3xl font-bold">{tc(city)} · {t(labelKey)}</h1>
      {/* P3-Y：垂直聚合页支持切城市（CitySwitcher 替换 city 段、保留 vertical 段：/hcm/food → /hn/food） */}
      <div className="flex justify-center">
        <CitySwitcher />
      </div>

      {/* 顶部入口：演示店 / 老板登录 / 免费开店（2026-09-01 #6：这些入口进垂直应用；聚合页已移除） */}
      <div className="flex flex-col gap-2">
        {DEMO_SLUG[vertical] && (
          <Link
            href={shopUrl({ vertical, slug: DEMO_SLUG[vertical]!, city })}
            className="flex items-center justify-center rounded-md border border-primary/40 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
          >
            {th('shopDemo')}
          </Link>
        )}
        <div className="flex gap-2">
          <Link
            href="/login"
            className="flex-1 rounded-md border border-zinc-300 px-4 py-2 text-center text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {th('bossLogin')}
          </Link>
          <Link
            href="/open"
            className="flex-1 rounded-md bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98]"
          >
            {th('freeOpen')}
          </Link>
        </div>
      </div>

      {shops.length === 0 ? (
        // 空态：该垂直暂无已入驻店铺（保留占位「敬请期待」）
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">{t('comingSoon')}</p>
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
    </main>
  )
}
