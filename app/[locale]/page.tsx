import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { Link } from '@/i18n/navigation'
import { verticalUrl } from '@/lib/urls'
import { getVisitorCity } from '@/lib/visitor-city'
import { VERTICALS, type Vertical } from '@/lib/vertical'
import { CitySwitcher } from '@/components/city-switcher'
import { listVerifiedShops } from '@/lib/aggs'

// 落地页（58 同城式门户雏形）：Hero + 垂直卡片入口 + 城市/语言切换。
// 2026-09-01 #5 重排：演示店/boss登录已挪进垂直应用（[city]/[vertical]/page.tsx），本页只做「聚合」该做的事。
// 垂直卡片 = 图标 + 垂直名 + 店铺数/敬请期待；城市段用 DEFAULT_CITY（CitySwitcher 切城市后由用户继续浏览）。

// 垂直 → 图标（卡片视觉，与 vertical-modules 无耦合；加垂直补一项即可）
const VERTICAL_ICON: Record<Vertical, string> = {
  FOOD: '🍜',
  MOTO: '🏍️',
  SALON: '💇',
  PET: '🐾',
  LAUNDRY: '🧺',
}

export default async function HomePage() {
  const t = await getTranslations('home')
  const ta = await getTranslations('admin')
  // P4-Z：落地页跟随访客最近选择的城市（cookie 记忆，缺省 DEFAULT_CITY）
  const city = await getVisitorCity()

  // 各垂直已入驻店铺数（并行查询；「敬请期待」= 0）
  const counts = await Promise.all(
    VERTICALS.map(async (v) => (await listVerifiedShops(v, city)).length),
  )

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-7 px-3 py-12 text-center">
      {/* Hero 区 */}
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold tracking-tight">
          <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
            {t('title')}
          </span>
        </h1>
        <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">{t('subtitle')}</p>
        <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-500">{t('tagline')}</p>
      </div>

      {/* 城市 + 语言切换 */}
      <div className="flex items-center gap-3">
        <CitySwitcher />
        <LocaleSwitcher />
      </div>

      {/* 垂直卡片入口：加垂直零改（VERTICALS 注册表驱动） */}
      <div className="grid w-full max-w-md grid-cols-2 gap-3">
        {VERTICALS.map((v, i) => {
          const key = 'vertical' + v[0] + v.slice(1).toLowerCase()
          const count = counts[i]
          return (
            <Link
              key={v}
              href={verticalUrl(v, city)}
              className="group flex flex-col items-center gap-1.5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="text-3xl">{VERTICAL_ICON[v]}</span>
              <span className="text-sm font-semibold">{ta(key)}</span>
              <span className="text-xs text-zinc-500">
                {count > 0 ? t('verticalCount', { n: count }) : ta('comingSoon')}
              </span>
            </Link>
          )
        })}
      </div>
    </main>
  )
}
