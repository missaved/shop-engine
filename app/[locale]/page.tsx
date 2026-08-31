import { useTranslations } from 'next-intl'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { Link } from '@/i18n/navigation'
import { shopUrl, verticalUrl } from '@/lib/urls'
import { DEFAULT_CITY } from '@/lib/city'
import { VERTICALS } from '@/lib/vertical'
import { CitySwitcher } from '@/components/city-switcher'

// 落地页：入口（下单界面 + 老板后台）+ 城市/语言切换 + 垂直入口（58同城式门户雏形）
export default function HomePage() {
  const t = useTranslations('home')
  const ta = useTranslations('admin')

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-3 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        {t('subtitle')}
      </p>
      <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-500">
        {t('tagline')}
      </p>
      {/* 城市 + 语言切换：切城市后跳 /{locale}/{city}/...（58同城式门户） */}
      <div className="flex items-center gap-3">
        <CitySwitcher />
        <LocaleSwitcher />
      </div>
      {/* 垂直入口：从默认城市出发，各垂直分类（阶段3 门户雏形） */}
      <div className="flex flex-wrap justify-center gap-3">
        {VERTICALS.map((v) => (
          <Link
            key={v}
            href={verticalUrl(v, DEFAULT_CITY)}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {ta('vertical' + v[0] + v.slice(1).toLowerCase())}
          </Link>
        ))}
      </div>
      <div className="flex gap-3">
        <Link
          href={shopUrl({ vertical: 'FOOD', slug: 'demo-pho', city: DEFAULT_CITY })}
          className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98]"
        >
          {t('shopDemo')}
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {t('bossLogin')}
        </Link>
      </div>
    </main>
  )
}
