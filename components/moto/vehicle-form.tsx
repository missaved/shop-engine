'use client'
// 车辆档案表单：新建/编辑（车牌 normalize 存储，手机号归一化，见 lib/plate、lib/phone）
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { saveVehicle } from '@/lib/moto-actions'
import type { VehiclePlain } from './types'

export function VehicleForm({
  initial,
  defaultPlate,
  onSaved,
  onCancel,
}: {
  initial?: VehiclePlain | null
  defaultPlate?: string
  onSaved: (v: VehiclePlain) => void
  onCancel?: () => void
}) {
  const t = useTranslations('moto')
  const [plate, setPlate] = useState(initial?.plate ?? defaultPlate ?? '')
  const [brand, setBrand] = useState(initial?.brand ?? '')
  const [model, setModel] = useState(initial?.model ?? '')
  const [year, setYear] = useState(initial?.year ? String(initial.year) : '')
  const [mileage, setMileage] = useState(initial?.mileage != null ? String(initial.mileage) : '')
  const [ownerName, setOwnerName] = useState(initial?.ownerName ?? '')
  const [ownerPhone, setOwnerPhone] = useState(initial?.ownerPhone ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      const v = await saveVehicle({
        plate,
        brand,
        model,
        year: year ? Number(year) : null,
        mileage: mileage !== '' ? Number(mileage) : null,
        ownerName,
        ownerPhone,
        notes,
      })
      onSaved(v)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-900'
  const label = 'text-xs font-medium text-zinc-500'

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className={label}>{t('plate')}</span>
          <input className={input} value={plate} onChange={(e) => setPlate(e.target.value)} autoCapitalize="characters" />
        </div>
        <div className="flex flex-col gap-1">
          <span className={label}>{t('brand')}</span>
          <input className={input} value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className={label}>{t('model')}</span>
          <input className={input} value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className={label}>{t('year')}</span>
          <input className={input} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" />
        </div>
        <div className="flex flex-col gap-1">
          <span className={label}>{t('mileage')}</span>
          <input className={input} value={mileage} onChange={(e) => setMileage(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
        </div>
        <div className="flex flex-col gap-1">
          <span className={label}>{t('ownerName')}</span>
          <input className={input} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <span className={label}>{t('ownerPhone')}</span>
          <input className={input} value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} inputMode="tel" />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <span className={label}>{t('notes')}</span>
          <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy || !plate.trim()}
          className="flex-1 rounded-xl bg-amber-500 px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? '…' : t('save')}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="rounded-xl border border-zinc-300 px-4 py-3 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
            {t('cancel')}
          </button>
        )}
      </div>
    </div>
  )
}
