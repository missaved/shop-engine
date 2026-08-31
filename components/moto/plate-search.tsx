'use client'
// 车牌搜索（核心入口，回车即查）：normalize 后精确匹配，有档案回调 onFound，无档案回调 onNotFound
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { findVehicleByPlate } from '@/lib/moto-actions'
import type { VehiclePlain } from './types'

export function PlateSearch({
  onFound,
  onNotFound,
  defaultPlate,
}: {
  onFound: (v: VehiclePlain) => void
  onNotFound: (plate: string) => void
  defaultPlate?: string
}) {
  const t = useTranslations('moto')
  const [q, setQ] = useState(defaultPlate ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const search = async () => {
    const plate = q.trim()
    if (!plate) return
    setBusy(true)
    setErr('')
    try {
      const v = await findVehicleByPlate(plate)
      if (v) onFound(v)
      else onNotFound(plate.toUpperCase())
    } catch (e) {
      setErr(e instanceof Error ? e.message : '搜索失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder={t('searchPlaceholder')}
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-lg tracking-wider outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-900"
          autoCapitalize="characters"
        />
        <button
          onClick={search}
          disabled={busy}
          className="shrink-0 rounded-xl bg-amber-500 px-5 py-3 text-lg font-medium text-white shadow-sm disabled:opacity-50"
        >
          {busy ? '…' : t('searchPlate')}
        </button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}
