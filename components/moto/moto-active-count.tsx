'use client'
// M2 顶栏「进行中 N」：未结单数
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { countMotoActive } from '@/lib/moto-actions'

export function MotoActiveCount() {
  const t = useTranslations('moto')
  const [n, setN] = useState<number | null>(null)
  const load = useCallback(async () => {
    try { setN(await countMotoActive()) } catch { /* ignore */ }
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
