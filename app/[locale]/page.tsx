import { useTranslations } from 'next-intl'
import { LocaleSwitcher } from '@/components/locale-switcher'

// 落地页（骨架阶段）：验证三语路由 + 语言切换
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
      <LocaleSwitcher />
    </main>
  )
}
