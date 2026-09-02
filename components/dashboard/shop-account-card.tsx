'use client'
// 账户与授权信息（参照 food 面板）：只读展示店名/slug/ID
import { useTranslations } from 'next-intl'

export function ShopAccountCard({ name, slug, id }: { name: string; slug: string; id: string }) {
  const t = useTranslations('dashboard')
  const rows: [string, string][] = [
    [t('shopName'), name],
    ['slug', slug],
    [t('shopId'), id],
  ]
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{t('accountAuth')}</h2>
      <div className="flex flex-col gap-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <span className="text-zinc-500">{k}</span>
            <span className="text-right font-medium break-all">{v}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
