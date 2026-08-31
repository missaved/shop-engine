'use client'
// M4.2 流水视图：按越南日查询（getMotoLedger），三 tab 分组 收入 / 欠款 / 收回
// 欠款不独立存：debt=total-paidAmount 推导；收回=当日已结清（debt==0）订单
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getMotoLedger } from '@/lib/moto-actions'
import { formatPrice } from '@/lib/format'

type LedgerRow = {
  id: string
  displayNo: string
  plate: string
  progress: string | null
  total: string
  paidAmount: string
  debt: string
  createdAt: string
}

type Ledger = { date: string; income: string; rows: LedgerRow[] }

type Tab = 'all' | 'debt' | 'paid'

export function MotoLedger({ currency }: { currency: string }) {
  const t = useTranslations('moto')
  // 默认今日（越南日）；type="date" 需要 YYYY-MM-DD
  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [tab, setTab] = useState<Tab>('all')
  const [ledger, setLedger] = useState<Ledger | null>(null)

  const load = useCallback(async (d: string) => {
    try {
      setLedger(await getMotoLedger(d))
    } catch {
      /* 忽略刷新失败 */
    }
  }, [])

  useEffect(() => {
    load(date)
  }, [date, load])

  const rows = ledger?.rows ?? []
  const debtRows = rows.filter((r) => Number(r.debt) > 0)
  const paidRows = rows.filter((r) => Number(r.debt) === 0)
  const shown = tab === 'debt' ? debtRows : tab === 'paid' ? paidRows : rows

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'all', label: t('ledgerAll'), n: rows.length },
    { key: 'debt', label: t('ledgerDebt'), n: debtRows.length },
    { key: 'paid', label: t('ledgerPaid'), n: paidRows.length },
  ]

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">
          {t('ledgerTitle')}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            {t('ledgerIncome')}: {formatPrice(Number(ledger?.income ?? 0), currency)}
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </div>

      <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === tb.key
                ? 'bg-white font-medium shadow-sm dark:bg-zinc-900'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {tb.label} ({tb.n})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">{t('needVehicle')}</p>
      ) : (
        <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {shown.map((r) => {
            const debt = Number(r.debt)
            return (
              <div key={r.id} className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold tracking-wider">{r.plate}</span>
                  <span className="text-xs text-zinc-400">{r.displayNo}</span>
                  {r.progress && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      {t(r.progress as never)}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">
                    {formatPrice(Number(r.total), currency)}
                  </div>
                  <div className={`text-xs ${debt > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                    {debt > 0
                      ? `${t('ledgerDebt')}: ${formatPrice(debt, currency)}`
                      : t('ledgerSettled')}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
