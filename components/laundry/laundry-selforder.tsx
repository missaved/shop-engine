'use client'
// 顾客自助下单：选服务(kg/件/洗鞋)+添加衣物明细+护理+取送 → 提交「待确认」单（老板交接确认出凭证）
import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { submitCustomerLaundryOrder } from '@/lib/laundry-actions'
import { formatPrice } from '@/lib/format'
import type { LaundryMode } from './types'

const SHOE: ('sport' | 'leather' | 'suede')[] = ['sport', 'leather', 'suede']

export function LaundrySelfOrder({ slug, currency, itemRates }: { slug: string; currency: string; itemRates?: { name: string; nameZh?: string; nameEn?: string; price: number }[] }) {
  const t = useTranslations('laundry')
  const locale = useLocale()
  const nm = (r: { name: string; nameZh?: string; nameEn?: string }) =>
    locale === 'zh' || locale === 'zh-Hant' ? r.nameZh || r.name : locale === 'en' || locale === 'ms' || locale === 'th' ? r.nameEn || r.name : r.name
  const [mode, setMode] = useState<LaundryMode>('kg')
  const [kg, setKg] = useState(5)
  const [items, setItems] = useState<{ name: string; count: number; mark?: string }[]>([])
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')

  const est = useMemo(() => {
    // 预估：kg 单价 20k 固定示意（正式金额交接时由老板按本店 rates 重算）
    return mode === 'kg' ? kg * 20000 : mode === 'shoe' ? 50000 : 30000
  }, [mode, kg])

  const submit = async () => {
    setBusy(true); setErr(''); setDone('')
    try {
      await submitCustomerLaundryOrder(slug, { mode, kg: mode === 'kg' ? kg : undefined, itemDetail: items, customerPhone: phone || undefined, note: note || undefined, idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
      setDone(t('submitOk'))
      setPhone(''); setNote(''); setItems([])
    } catch (e) { setErr(e instanceof Error ? e.message : t('error')) } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-5 py-8">
      <h1 className="text-2xl font-bold">{t('selfOrder')}</h1>
      <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {(['kg', 'item', 'shoe'] as LaundryMode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold ${mode === m ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}`}>
            {m === 'kg' ? t('modeKg') : m === 'item' ? t('modeItem') : t('modeShoe')}
          </button>
        ))}
      </div>
      {mode === 'kg' && (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
          <button onClick={() => setKg(Math.max(kg - 1, 0))} className="h-12 w-12 rounded-lg bg-white text-xl font-bold dark:bg-zinc-800">−</button>
          <span className="min-w-24 text-center text-4xl font-extrabold">{kg}</span>
          <button onClick={() => setKg(kg + 1)} className="h-12 w-12 rounded-lg bg-white text-xl font-bold dark:bg-zinc-800">＋</button>
        </div>
      )}
      {mode === 'item' && (
        <div className="flex flex-wrap gap-2">
          {(itemRates ?? []).map((r) => (
            <button key={r.name} onClick={() => setItems((a) => { const f = a.find((x) => x.name === r.name); return f ? a.map((x) => (x.name === r.name ? { ...x, count: x.count + 1 } : x)) : [...a, { name: r.name, count: 1 }] })} className="rounded-full border border-zinc-200 px-3 py-2 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-800">
              {nm(r)} <span className="text-xs text-zinc-400">{formatPrice(r.price, currency)}</span>
            </button>
          ))}
        </div>
      )}
      {mode === 'shoe' && (
        <div className="flex gap-2">
          {SHOE.map((s) => (
            <button key={s} className="flex-1 rounded-lg bg-zinc-100 py-2 text-sm font-semibold dark:bg-zinc-800">{s === 'sport' ? t('shoeSport') : s === 'leather' ? t('shoeLeather') : t('shoeSuede')}</button>
          ))}
        </div>
      )}
      {/* 衣物明细（可多件，带污渍点） */}
      <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{t('itemDetailLabel')}</span>
          <button onClick={() => setItems((a) => [...a, { name: '', count: 1 }])} className="text-xs font-semibold text-amber-600">{t('addItem')}</button>
        </div>
        {items.map((it, i) => (
          <div key={i} className="mb-2 flex items-center gap-2">
            <input value={it.name} onChange={(e) => setItems((a) => a.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))} placeholder={t('itemName')} className="flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            <input value={it.count} onChange={(e) => setItems((a) => a.map((x, idx) => (idx === i ? { ...x, count: Number(e.target.value) || 0 } : x)))} inputMode="numeric" className="w-12 rounded-lg border border-zinc-200 px-2 py-1 text-sm text-center dark:border-zinc-700 dark:bg-zinc-800" />
            <input value={it.mark ?? ''} onChange={(e) => setItems((a) => a.map((x, idx) => (idx === i ? { ...x, mark: e.target.value } : x)))} placeholder={t('itemMark')} className="flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            <button onClick={() => setItems((a) => a.filter((_, idx) => idx !== i))} className="text-zinc-400">✕</button>
          </div>
        ))}
      </div>

      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('customerPhone')} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('note')} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-500">{t('estimateNote')}</span>
        <span className="font-bold">{formatPrice(est, currency)}</span>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {done && <p className="text-sm text-green-600">{done}</p>}
      <button onClick={submit} disabled={busy} className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-3 text-sm font-semibold text-white disabled:opacity-50">{t('submitOrder')}</button>
    </main>
  )
}
