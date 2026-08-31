'use client'
// M4.1 概览卡：今日实收 / 待取车辆 / 待提醒 / 欠款总额
// 30s 轮询 getMotoOverview（与订单/提醒同节奏，改动即时反映）
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getMotoOverview } from '@/lib/moto-actions'
import { formatPrice } from '@/lib/format'

type Overview = {
  todayRevenue: string
  waitingPickup: number
  dueReminders: number
  debtTotal: string
}

export function MotoStats({ currency }: { currency: string }) {
  const t = useTranslations('moto')
  const [o, setO] = useState<Overview | null>(null)

  const load = useCallback(async () => {
    try {
      setO(await getMotoOverview())
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
    {
      label: t('statsTodayRevenue'),
      value: formatPrice(Number(o.todayRevenue), currency),
      cls: 'text-amber-600 dark:text-amber-400',
    },
    { label: t('statsWaitingPickup'), value: String(o.waitingPickup), cls: 'text-zinc-900 dark:text-zinc-100' },
    { label: t('statsDueReminders'), value: String(o.dueReminders), cls: 'text-zinc-900 dark:text-zinc-100' },
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
