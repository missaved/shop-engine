'use client'
// L5 今日概览 4 卡：今日公斤 / 今日营收 / 待取 / 欠款总额（30s 轮询）
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getLaundryOverview } from '@/lib/laundry-actions'
import { formatPrice } from '@/lib/format'

type Overview = { todayKg: number; todayRevenue: string; waitingPickup: number; debtTotal: string }

export function LaundryStats({ currency }: { currency: string }) {
  const t = useTranslations('laundry')
  const [o, setO] = useState<Overview | null>(null)
  const load = useCallback(async () => {
    try {
      setO(await getLaundryOverview())
    } catch {
      /* 忽略刷新失败 */
    }
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load])
  if (!o) return null
  const debt = Number(o.debtTotal)
  const cards = [
    { label: t('statsTodayKg'), value: `${o.todayKg}kg`, cls: 'text-amber-600 dark:text-amber-400' },
    {
      label: t('statsTodayRevenue'),
      value: formatPrice(Number(o.todayRevenue), currency),
      cls: 'text-zinc-900 dark:text-zinc-100',
    },
    { label: t('statsWaitingPickup'), value: String(o.waitingPickup), cls: 'text-zinc-900 dark:text-zinc-100' },
    {
      label: t('statsDebtTotal'),
      value: formatPrice(debt, currency),
      cls: debt > 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-100',
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="text-xs text-zinc-500">{c.label}</p>
          <p className={`mt-0.5 text-lg font-bold ${c.cls}`}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}
