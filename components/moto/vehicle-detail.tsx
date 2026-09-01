'use client'
// 车辆档案详情：档案 + 历史订单履历 + 下次保养 + 同手机号其他车
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getVehicleDetail, getMotoPresetCatalog, addMotoItems, removeMotoItem } from '@/lib/moto-actions'
import { formatPrice } from '@/lib/format'
import type { VehiclePlain, MotoServiceItem } from './types'

// 加项下拉用全库预设（getMotoPresetCatalog）
type CatalogItem = {
  serviceKey: string
  nameVi: string
  price: string
}

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
    // P2-AP：历史单 items 展示/加删项
    items: MotoServiceItem[]
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
  // P2-AP 加/删服务项：一次展开一单；全库预设下拉
  const [addOpenId, setAddOpenId] = useState('')
  const [addServiceKey, setAddServiceKey] = useState('')
  const [addQty, setAddQty] = useState('1')
  const [busyOrderId, setBusyOrderId] = useState('')
  const [catalog, setCatalog] = useState<CatalogItem[]>([])

  useEffect(() => {
    getVehicleDetail(vehicle.id).then(setD).catch(() => setD(null))
  }, [vehicle.id])

  // P2-AP：加项下拉数据（全库预设；加载后默认选中第一个，便于直接确认）
  useEffect(() => {
    getMotoPresetCatalog()
      .then((rows) => {
        setCatalog(rows)
        setAddServiceKey((k) => k || rows[0]?.serviceKey || '')
      })
      .catch(() => setCatalog([]))
  }, [])

  // P2-AP 加服务项：服务端计价，客户端只传 serviceKey+qty
  const addItem = async (o: Detail['orders'][number]) => {
    const key = addServiceKey || catalog[0]?.serviceKey
    if (!key) return
    setBusyOrderId(o.id)
    try {
      await addMotoItems(o.id, [{ serviceKey: key, qty: Number(addQty || '1') }])
      await getVehicleDetail(vehicle.id).then(setD)
    } catch {
      /* 忽略刷新失败 */
    } finally {
      setBusyOrderId('')
    }
  }

  // P2-AP 删服务项：按行 index
  const removeItem = async (o: Detail['orders'][number], idx: number) => {
    setBusyOrderId(o.id)
    try {
      await removeMotoItem(o.id, idx)
      await getVehicleDetail(vehicle.id).then(setD)
    } catch {
      /* 忽略刷新失败 */
    } finally {
      setBusyOrderId('')
    }
  }

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
                {d.orders.map((o) => {
                  const odone = o.status === 'COMPLETED' || o.status === 'CANCELLED'
                  return (
                    <div key={o.id} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
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
                      {/* P2-AP 服务项摘要 */}
                      {o.items.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {o.items.map((it, idx) => (
                            <span
                              key={idx}
                              className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            >
                              {it.name} ×{it.qty}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* 非终态单可加/删服务项 */}
                      {!odone && (
                        <button
                          onClick={() => setAddOpenId(addOpenId === o.id ? '' : o.id)}
                          disabled={busyOrderId === o.id}
                          className="mt-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                        >
                          {t('addItem')}
                        </button>
                      )}
                      {!odone && addOpenId === o.id && (
                        <div className="mt-2 rounded-lg border border-dashed border-amber-300 p-2 dark:border-amber-600">
                          <div className="flex gap-2">
                            <select
                              value={addServiceKey}
                              onChange={(e) => setAddServiceKey(e.target.value)}
                              className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              {catalog.map((p) => (
                                <option key={p.serviceKey} value={p.serviceKey}>
                                  {p.nameVi}（{formatPrice(Number(p.price), currency)}）
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              value={addQty}
                              onChange={(e) => setAddQty(e.target.value)}
                              min="1"
                              className="w-16 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            />
                            <button
                              onClick={() => addItem(o)}
                              disabled={busyOrderId === o.id || !addServiceKey}
                              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                            >
                              {t('confirmAdd')}
                            </button>
                          </div>
                          {o.items.length > 0 ? (
                            <div className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
                              {o.items.map((it, idx) => (
                                <div key={idx} className="flex items-center justify-between py-1.5 text-sm">
                                  <span>
                                    {it.name} ×{it.qty}
                                    <span className="ml-1 text-xs text-zinc-400">
                                      {it.kind === 'part' ? t('partFee') : t('laborFee')}
                                    </span>
                                  </span>
                                  <span className="flex items-center gap-2">
                                    <span>{formatPrice(it.price * it.qty, currency)}</span>
                                    <button
                                      onClick={() => removeItem(o, idx)}
                                      disabled={busyOrderId === o.id}
                                      className="text-red-500"
                                    >
                                      {t('removeItem')}
                                    </button>
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-zinc-400">{t('noService')}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
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
