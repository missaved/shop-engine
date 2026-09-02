'use client'
// 历史订单查询（最近 90 天，只读快照；默认折叠）——laundry/moto 复用 food 的 searchOrderHistory
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { searchOrderHistory, type HistoryOrderRow } from '@/lib/actions'
import { formatPrice } from '@/lib/format'

type Row = HistoryOrderRow

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function HistoryOrderSearch({ currency }: { currency: string }) {
  const t = useTranslations('dashboard')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [searched, setSearched] = useState(false)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)

  const search = async () => {
    setBusy(true)
    try {
      setRows(await searchOrderHistory({ query: q, days: 90 }))
      setSearched(true)
    } catch {
      setRows([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{t('orderHistory')}</h2>
        <span className="text-xs text-zinc-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <div className="flex items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder={t('histQuery')} className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            <button type="button" onClick={search} disabled={busy} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{t('search')}</button>
          </div>
          {searched && rows.length === 0 && <p className="py-4 text-center text-sm text-zinc-400">{t('histEmpty')}</p>}
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <div key={r.id} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.displayNo}</span>
                  <span className="text-xs text-zinc-400">{fmtDate(String(r.createdAt))}</span>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {r.status} · {formatPrice(Number(r.total), currency)}{r.customerPhone ? ` · ${r.customerPhone}` : ''}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
