// 城市门户页：/{locale}/{city}。该城市的垂直入口（58同城式一级门户）。
// city 已为数据维度（Shop.city）；垂直入口按城市段聚合（verticalUrl 带 city）。
// 与 /{locale}/{city}/{vertical}（聚合页）、/{locale}/{city}/{vertical}/{slug}（单店）按段数区分，不冲突。
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseCitySlug, cityMeta } from '@/lib/city'
import { VERTICALS } from '@/lib/vertical'
import { verticalUrl, shopUrl } from '@/lib/urls'
import { Link } from '@/i18n/navigation'
import { CitySwitcher } from '@/components/city-switcher'

export default async function CityHomePage({
  params,
}: {
  params: Promise<{ locale: string; city: string }>
}) {
  const { city: cityParam } = await params
  const city = parseCitySlug(cityParam)
  if (!city) notFound()
  const meta = cityMeta(city)
  const ta = await getTranslations('admin')

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-6 py-12 text-center">
      <h1 className="text-3xl font-bold">{meta.nameEn}</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {meta.flag} {meta.name} · {meta.country}
      </p>
      <CitySwitcher />

      {/* 垂直分类入口（58同城式） */}
      <div className="flex flex-wrap justify-center gap-3">
        {VERTICALS.map((v) => (
          <Link
            key={v}
            href={verticalUrl(v, city)}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {ta('vertical' + v[0] + v.slice(1).toLowerCase())}
          </Link>
        ))}
      </div>

      {/* 该城市示例店入口（阶段3 城市全店列表后续深化） */}
      <Link
        href={shopUrl({ vertical: 'FOOD', slug: 'demo-pho', city })}
        className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98]"
      >
        {meta.nameEn} · Demo
      </Link>
    </main>
  )
}
