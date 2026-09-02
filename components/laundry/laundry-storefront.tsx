'use client'
// 洗衣客户落地页：店名/地址/营业时间 + 匿名查单(手机号+取件码) + 登录看会员/订单
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { lookupLaundryOrder } from '@/lib/laundry-actions'
import { formatPrice } from '@/lib/format'

const STATUS_KEY: Record<string, string> = {
  washing_pending: 'progressWashingPending', washing: 'progressWashing', qc: 'progressQc', ready: 'progressReady', collected: 'progressCollected',
}

export function LaundryStorefront({ slug, currency, shopName, address, city }: { slug: string; currency: string; shopName: string; address: string | null; city: string }) {
  const t = useTranslations('laundry')
  const [phone, setPhone] = useState('')
  const [tag, setTag] = useState('')
  const [result, setResult] = useState<{ displayNo: string; tagCode: string; laundryStatus: string; total: string; paidAmount: string } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const lookup = async () => {
    setBusy(true); setErr(''); setResult(null)
    try { setResult(await lookupLaundryOrder(slug, phone, tag)) }
    catch (e) { setErr(e instanceof Error ? e.message : t('error')) } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-5 py-8">
      <h1 className="text-2xl font-bold">{shopName}</h1>
      {address && <p className="text-sm text-zinc-500">{address}</p>}
      <p className="text-sm text-zinc-500">🧺 {t('shopTagline')}</p>

      {/* 匿名查单 */}
      <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('lookupTitle')}</h2>
        <div className="grid grid-cols-1 gap-2">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('customerPhone')} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t('tagPlaceholder')} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
          <button onClick={lookup} disabled={busy} className="rounded-xl bg-amber-500 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('lookup')}</button>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        {result && (
          <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
            <div className="flex justify-between"><span className="text-zinc-500">{t('orderNo')}</span><span className="font-semibold">{result.displayNo}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-zinc-500">{t('status')}</span><span className="font-medium">{t(STATUS_KEY[result.laundryStatus] ?? 'progressReady')}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-zinc-500">{t('total')}</span><span className="font-semibold">{formatPrice(Number(result.total), currency)}</span></div>
          </div>
        )}
      </section>

      {/* 登录看会员/订单 */}
      <Link href={`/${city}/laundry/${slug}/my`}>
        <span className="block rounded-xl bg-zinc-900 py-3 text-center text-sm font-semibold text-white">{t('myOrders')}</span>
      </Link>
    </main>
  )
}
