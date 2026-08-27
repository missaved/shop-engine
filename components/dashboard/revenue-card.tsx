'use client'

// 营业额卡片：默认显示今日营业额，点击展开 1/3/7/30 天明细二级菜单
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { formatPrice } from '@/lib/format'

const RANGES = [
  { days: 1, key: 'revenue1d' },
  { days: 3, key: 'revenue3d' },
  { days: 7, key: 'revenue7d' },
  { days: 30, key: 'revenue30d' },
] as const

export function RevenueCard({
  day1,
  day3,
  day7,
  day30,
  count1,
  count3,
  count7,
  count30,
}: {
  day1: number
  day3: number
  day7: number
  day30: number
  count1: number
  count3: number
  count7: number
  count30: number
}) {
  const t = useTranslations('dashboard')
  const [expanded, setExpanded] = useState(false)
  const values: Record<number, number> = { 1: day1, 3: day3, 7: day7, 30: day30 }
  const counts: Record<number, number> = { 1: count1, 3: count3, 7: count7, 30: count30 }

  return (
    <div className="relative flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white p-3 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full flex-col items-center" title={t('revenue')}>
        <svg
          className="h-5 w-5 text-amber-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
        <p className="mt-1 text-2xl font-semibold text-amber-600 dark:text-amber-500">
          {formatPrice(day1)}đ
        </p>
        <p className="text-xs text-zinc-500">{t('revenue')}</p>
      </button>
      {expanded && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-lg border border-zinc-200 bg-white p-2 text-left shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {RANGES.map((r) => (
            <div
              key={r.days}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <span className="text-xs text-zinc-500">{t(r.key)}</span>
              <span className="text-xs text-zinc-400">
                {t('ordersCount', { n: counts[r.days] })}
              </span>
              <span className="text-sm font-semibold text-amber-600 dark:text-amber-500">
                {formatPrice(values[r.days])}đ
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
