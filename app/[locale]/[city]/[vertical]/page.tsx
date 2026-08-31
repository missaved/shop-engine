// 垂直聚合页（分类页）：/{city}/{vertical}。列举该垂直已验证店铺（重构点 #4，从占位升级为真实列表）。
// 「加垂直零改」：核心逻辑跨垂直通用（listVerifiedShops + 模块 aggregation.card），
// 加垂直只加 vertical.ts 一项 + vertical-modules 一个模块，本页零改。
// 段数约定：`/{city}/food` → 本页；`/{city}/food/{slug}` → [vertical]/[slug] 单店页（Next 按段数区分，不冲突）。
// 非合法垂直短码（如老式 /en/{slug}）→ 404。
// 城市段（58 同城式 /{locale}/{city}/{vertical}）：city 已为数据维度（Shop.city），聚合按城市过滤（阶段3 起步）。
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseVerticalSlug } from '@/lib/vertical'
import { parseCitySlug, cityMeta } from '@/lib/city'
import { getVerticalModule } from '@/lib/vertical-modules'
import { listVerifiedShops, defaultAggCard } from '@/lib/aggs'
import { shopUrl } from '@/lib/urls'
import { Link } from '@/i18n/navigation'

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

  // 垂直差异注入：模块 aggregation.card 可覆盖为差异化卡片；未实现 → 通用 defaultAggCard 兜底
  const cardFn = getVerticalModule(vertical).aggregation?.card ?? defaultAggCard
  const shops = await listVerifiedShops(vertical, city)

  // 垂直名：admin.vertical{Food/Moto/Salon/Pet/Laundry}（FOOD→'verticalFood' 等，matched messages）
  const labelKey = 'vertical' + vertical[0] + vertical.slice(1).toLowerCase()

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <h1 className="text-center text-3xl font-bold">{cityMeta(city).nameEn} · {t(labelKey)}</h1>

      {shops.length === 0 ? (
        // 空态：该垂直暂无已入驻店铺（保留占位「敬请期待」）
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">{t('comingSoon')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {shops.map((s) => {
            const card = cardFn(s, { locale })
            return (
              <Link
                key={card.slug}
                href={shopUrl({ vertical, slug: card.slug, city })}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                <span className="text-lg font-medium">{card.title}</span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {card.badge === 'open' ? td('open') : td('closed')}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </main>
  )
}
