'use client'

// 营业额卡片：默认隐藏数值，点击 1/3/7/30 天切换显示，再点同档隐藏
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
}: {
  day1: number
  day3: number
  day7: number
  day30: number
}) {
  const t = useTranslations('dashboard')
  const [selected, setSelected] = useState<number | null>(null) // null = 隐藏数值
  const values: Record<number, number> = { 1: day1, 3: day3, 7: day7, 30: day30 }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <button onClick={() => setSelected(null)} className="w-full" title={t('hideRevenue')}>
        <p className="text-2xl font-semibold text-amber-600 dark:text-amber-500">
          {selected === null ? '•••••' : `${formatPrice(values[selected])}đ`}
        </p>
        <p className="text-xs text-zinc-500">{t('revenue')}</p>
      </button>
      <div className="mt-2 flex justify-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.days}
            onClick={() => setSelected(selected === r.days ? null : r.days)}
            className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
              selected === r.days
                ? 'bg-amber-500 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
          >
            {t(r.key)}
          </button>
        ))}
      </div>
    </div>
  )
}
