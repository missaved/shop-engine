'use client'
// 车辆档案详情：档案 + 历史订单履历 + 下次保养 + 同手机号其他车
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getVehicleDetail } from '@/lib/moto-actions'
import { formatPrice } from '@/lib/format'
import type { VehiclePlain } from './types'

type Detail = {
  vehicle: VehiclePlain
  orders: {
    id: string
    displayNo: string
    status: string
    total: string
    paidAmount: string
    createdAt: string
    progress: string | null
  }[]
  samePhoneVehicles: VehiclePlain[]
}

export function VehicleDetail({
  vehicle,
  currency,
  onBack,
  onEdit,
  onCreateOrder,
}: {
  vehicle: VehiclePlain
  currency: string
  onBack: () => void
  onEdit: () => void
  onCreateOrder: (v: VehiclePlain) => void
}) {
  const t = useTranslations('moto')
  const [d, setD] = useState<Detail | null>(null)

  useEffect(() => {
    getVehicleDetail(vehicle.id).then(setD).catch(() => setD(null))
  }, [vehicle.id])

  const row = 'flex items-center justify-between py-1.5 text-sm'
  const key = 'text-zinc-500'
  const val = 'font-medium'

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-lg font-bold tracking-wider">{vehicle.plate}</span>
          <span className="text-sm text-zinc-500">
            {vehicle.brand && vehicle.model ? `${vehicle.brand} ${vehicle.model}` : vehicle.model || vehicle.brand || '—'}
          </span>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {vehicle.year != null && (
            <div className={row}><span className={key}>{t('year')}</span><span className={val}>{vehicle.year}</span></div>
          )}
          {vehicle.mileage != null && (
            <div className={row}><span className={key}>{t('mileage')}</span><span className={val}>{vehicle.mileage.toLocaleString()}</span></div>
          )}
          {vehicle.ownerName && (
            <div className={row}><span className={key}>{t('ownerName')}</span><span className={val}>{vehicle.ownerName}</span></div>
          )}
          {vehicle.ownerPhone && (
            <div className={row}><span className={key}>{t('ownerPhone')}</span><span className={val}>{vehicle.ownerPhone}</span></div>
          )}
          {vehicle.nextServiceDue && (
            <div className={row}>
              <span className={key}>{t('nextService')}</span>
              <span className={val}>
                {new Date(vehicle.nextServiceDue).toLocaleDateString()}
                {vehicle.nextServiceKm != null ? ` · ${vehicle.nextServiceKm.toLocaleString()}km` : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => onCreateOrder(vehicle)} className="flex-1 rounded-xl bg-amber-500 px-4 py-3 font-medium text-white">
          {t('createOrder')}
        </button>
        <button onClick={onEdit} className="rounded-xl border border-zinc-300 px-4 py-3 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
          {t('save')}
        </button>
      </div>

      {d && (
        <>
          <section>
            <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('history')}</h3>
            {d.orders.length === 0 ? (
              <p className="text-sm text-zinc-400">{t('needVehicle')}</p>
            ) : (
              <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {d.orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{o.displayNo}</span>
                      <span className="ml-2 text-xs text-zinc-400">
                        {new Date(o.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500">{o.progress ? t(o.progress as never) : ''}</span>
                      <span className="font-medium">{formatPrice(Number(o.total), currency)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {d.samePhoneVehicles.length > 0 && (
            <section>
              <h3 className="mb-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('otherVehicles')}</h3>
              <div className="flex flex-wrap gap-2">
                {d.samePhoneVehicles.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => onCreateOrder(v)}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700"
                  >
                    {v.plate}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <button onClick={onBack} className="text-sm text-zinc-500">
        ← {t('back')}
      </button>
    </div>
  )
}
