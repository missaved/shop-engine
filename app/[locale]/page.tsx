import { useTranslations } from 'next-intl'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { Link } from '@/i18n/navigation'

// 落地页：入口（下单界面 + 老板后台）+ 三语切换
export default function HomePage() {
  const t = useTranslations('home')

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        {t('subtitle')}
      </p>
      <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-500">
        {t('tagline')}
      </p>
      <div className="flex gap-3">
        <Link
          href="/s/demo-pho"
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
      <LocaleSwitcher />
    </main>
  )
}
