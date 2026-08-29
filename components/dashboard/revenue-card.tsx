'use client'

// 营业额卡片（整行独立展示）：今日营业额大字 + 3/7/30 天明细横排网格常驻
// 不再塞进三卡并排的 grid，也不再绝对定位下拉（Issue9 布局重构）
import { useTranslations } from 'next-intl'
import { formatPrice } from '@/lib/format'

// 明细档位（今日已在顶部大字，网格只列 3/7/30）
const RANGES = [
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
  currency,
}: {
  day1: number
  day3: number
  day7: number
  day30: number
  count1: number
  count3: number
  count7: number
  count30: number
  currency: string
}) {
  const t = useTranslations('dashboard')
  const values: Record<number, number> = { 1: day1, 3: day3, 7: day7, 30: day30 }
  const counts: Record<number, number> = { 1: count1, 3: count3, 7: count7, 30: count30 }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-500">{t('revenue')}</p>
          <p className="mt-1 text-3xl font-semibold text-amber-600 dark:text-amber-500">
            {formatPrice(day1, currency)}
          </p>
        </div>
        <p className="text-xs text-zinc-400">{t('ordersCount', { n: count1 })}</p>
      </div>

      {/* 3/7/30 天明细常驻网格（整行宽度，不折叠不悬停） */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        {RANGES.map((r) => (
          <div key={r.days} className="flex flex-col gap-0.5">
            <span className="text-xs text-zinc-500">{t(r.key)}</span>
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {formatPrice(values[r.days], currency)}
            </span>
            <span className="text-xs text-zinc-400">
              {t('ordersCount', { n: counts[r.days] })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
