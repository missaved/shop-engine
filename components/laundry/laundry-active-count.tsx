'use client'
// B2 顶栏「进行中 N」：未结单数（submitted/待洗/洗涤中/质检/待取）
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { countLaundryActive } from '@/lib/laundry-actions'

export function LaundryActiveCount() {
  const t = useTranslations('laundry')
  const [n, setN] = useState<number | null>(null)
  const load = useCallback(async () => {
    try { setN(await countLaundryActive()) } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load])
  if (n === null) return null
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span className="h-2 w-2 rounded-full bg-amber-500" />
      {t('activeCount', { n })}
    </span>
  )
}
