'use client'
// 顾客侧洗衣视图：登录顾客看本店储值/卡/订单进度（requireCustomer 已守卫）
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { getMyLaundry, reorderLaundry } from '@/lib/laundry-actions'
import { formatPrice } from '@/lib/format'
import { LocaleSwitcher } from '@/components/locale-switcher'

type Order = { id: string; displayNo: string; status: string; laundryStatus: string; tagCode: string | null; total: string; paidAmount: string; createdAt: string }

const STATUS_KEY: Record<string, string> = {
  submitted: 'progressSubmitted', washing_pending: 'progressWashingPending', washing: 'progressWashing', qc: 'progressQc', ready: 'progressReady', collected: 'progressCollected',
}

export function LaundryCustomer({ slug, currency, shopName, city }: { slug: string; currency: string; shopName: string; city: string }) {
  const t = useTranslations('laundry')
  const [data, setData] = useState<{ customer: { balance: string; phone: string | null; name: string | null; cards: { id: string; type: string; name: string | null; remainingCount: number | null; balance: string }[] } | null; orders: Order[] } | null>(null)
  const reload = async () => {
    try { setData(await getMyLaundry(slug, 'LAUNDRY', 'hcm')) } catch { /* ignore */ }
  }

  useEffect(() => { reload() }, [slug])

  const doReorder = async (id: string) => {
    try { await reorderLaundry(id); await reload() } catch { /* ignore */ }
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-5 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{shopName}</h1>
        <LocaleSwitcher />
      </div>
      <Link href={`/${city}/laundry/${slug}/order`}>
        <span className="block rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-3 text-center text-sm font-bold text-white shadow-md">{t('wantWash')} →</span>
      </Link>
      {data?.customer && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-500">{t('balance')}</span>
            <span className="text-2xl font-extrabold text-amber-600">{formatPrice(Number(data.customer.balance), currency)}</span>
          </div>
          {data.customer.cards.length > 0 && (
            <ul className="mt-2 text-sm text-zinc-600">
              {data.customer.cards.map((c) => (
                <li key={c.id} className="flex justify-between">
                  <span>{c.name ?? (c.type === 'count' ? t('cardCountName') : t('cardCreditName'))}</span>
                  <span className="font-medium">{c.type === 'count' ? `${c.remainingCount} ${t('times')}` : formatPrice(Number(c.balance), currency)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-zinc-500">{t('rechargeHint')}</p>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('myOrders')}</h2>
        {data && data.orders.length === 0 && <p className="text-sm text-zinc-400">{t('empty')}</p>}
        {data?.orders.map((o) => {
          const ready = o.laundryStatus === 'ready'
          return (
            <div key={o.id} className={`rounded-xl border p-3 ${ready ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950' : 'border-zinc-200 dark:border-zinc-800'}`}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{o.displayNo}</span>
                <span className="flex items-center gap-2">
                  {ready && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">{t('readyBadge')}</span>}
                  <span className="text-xs text-zinc-500">{o.tagCode}</span>
                </span>
              </div>
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-zinc-500">{t(STATUS_KEY[o.laundryStatus] ?? 'progressReady')}</span>
                <span className="font-medium">{formatPrice(Number(o.total), currency)}</span>
              </div>
              {/* 进度步骤 */}
              <div className="mt-2 flex gap-1">
                {['washing_pending', 'washing', 'qc', 'ready', 'collected'].map((s, i) => (
                  <div key={s} className={`h-1 flex-1 rounded ${['submitted', 'washing_pending', 'washing', 'qc', 'ready', 'collected'].indexOf(o.laundryStatus) >= i ? 'bg-amber-500' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
                ))}
              </div>
              <button onClick={() => doReorder(o.id)} className="mt-2 w-full rounded-lg bg-zinc-900 py-1.5 text-xs font-semibold text-white">{t('reorder')}</button>
            </div>
          )
        })}
      </section>
    </main>
  )
}
