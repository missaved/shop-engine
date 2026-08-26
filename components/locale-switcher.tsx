'use client'

import { useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'

// 三语切换器（落地页演示用）
export function LocaleSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-2 text-sm">
      {routing.locales.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => router.replace(pathname, { locale: loc })}
          className={
            loc === locale
              ? 'font-semibold underline underline-offset-4'
              : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
          }
        >
          {loc.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
