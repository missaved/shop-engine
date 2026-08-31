'use client'
// 7 步开单向导（计划 10.4b）：车牌→车辆→症状→服务→报价→时间→电话→开工
// 原则「能带出就不输、能点选就不打字」；打字仅剩 3 处可选输入
import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { createMotoOrder } from '@/lib/moto-actions'
import { formatPrice } from '@/lib/format'
import { PlateSearch } from './plate-search'
import { PlateCamera } from './plate-camera'
import { VehicleForm } from './vehicle-form'
import type { MotoServiceItem, MotoPresetItem, MotoShop, VehiclePlain } from './types'

// 常见症状标签（多语言）：点选存本地语言原文（凭证页直接展示，MVP 不做翻译映射）
const COMMON_SYMPTOMS: Record<string, string[]> = {
  vi: ['Khó đề', 'Kêu lạ', 'Thắng không ăn', 'Rỉ nhớt', 'Xì lốp', 'Đèn không sáng', 'Hết bình', 'Kêu xích', 'Yếu ga'],
  zh: ['打火困难', '异响', '刹车不灵', '漏机油', '胎漏气', '灯不亮', '电瓶没电', '链条响', '加速无力'],
  en: ['Hard to start', 'Strange noise', 'Weak brake', 'Oil leak', 'Flat tire', 'Light out', 'Dead battery', 'Chain noise', 'Slow pickup'],
  'zh-Hant': ['難發動', '異響', '煞車不靈', '漏機油', '胎漏氣', '燈不亮', '電瓶沒電', '鏈條響', '加速無力'],
  ms: ['Susah start', 'Bunyi aneh', 'Brek lemah', 'Bocor minyak', 'Tayar bocor', 'Lampu mati', 'Bateri mati', 'Bunyi rantai', 'Pickup lambat'],
  th: ['สตาร์ทยาก', 'เสียงผิดปกติ', 'เบรกไม่ค่อยทำงาน', 'น้ำมันเครื่องรั่ว', 'ยางรั่ว', 'ไฟไม่ติด', 'แบตหมด', 'เสียงโซ่', 'เร่งไม่ขึ้น'],
}

// 预估时间档位（存本地化显示串，凭证页展示即用）
const TIME_SLOTS = ['t30m', 't1h', 't2h', 'tHalfDay', 'tToday', 'tTomorrow'] as const

export function QuickOrder({
  shop,
  initialVehicle,
  initialPlate,
  onDone,
  onBack,
}: {
  shop: MotoShop
  initialVehicle?: VehiclePlain | null
  initialPlate?: string
  onDone?: (r: { displayNo: string }) => void
  onBack?: () => void
}) {
  const t = useTranslations('moto')
  const locale = useLocale()

  // —— 向导状态 ——
  const [step, setStep] = useState(initialVehicle || initialPlate ? 1 : 0)
  const [plate, setPlate] = useState(initialPlate ?? initialVehicle?.plate ?? '')
  const [vehicle, setVehicle] = useState<VehiclePlain | null>(initialVehicle ?? null)
  const [brand, setBrand] = useState(initialVehicle?.brand ?? '')
  const [model, setModel] = useState(initialVehicle?.model ?? '')
  const [year, setYear] = useState(initialVehicle?.year ? String(initialVehicle.year) : '')
  const [mileage, setMileage] = useState(initialVehicle?.mileage != null ? String(initialVehicle.mileage) : '')
  const [ownerName, setOwnerName] = useState(initialVehicle?.ownerName ?? '')
  const [ownerPhone, setOwnerPhone] = useState(initialVehicle?.ownerPhone ?? '')
  const [symptoms, setSymptoms] = useState<string[]>([])
  const [customSymptom, setCustomSymptom] = useState('')
  const [services, setServices] = useState<MotoServiceItem[]>([])
  const [discount, setDiscount] = useState(0)
  const [confirmedQuote, setConfirmedQuote] = useState(false)
  const [estimatedDue, setEstimatedDue] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const presets: MotoPresetItem[] = shop.config?.presets ?? []
  const commonModels: string[] = shop.config?.commonModels ?? []

  // —— 派生 ——
  const subtotal = services.reduce((s, it) => s + it.price * it.qty, 0)
  const total = Math.max(subtotal - discount, 0)
  const partFee = services.filter((it) => it.kind === 'part').reduce((s, it) => s + it.price * it.qty, 0)
  const laborFee = services.filter((it) => it.kind === 'labor').reduce((s, it) => s + it.price * it.qty, 0)

  const addService = (p: MotoPresetItem) => {
    setServices((prev) => {
      const exist = prev.find((it) => it.name === p.name)
      if (exist) {
        return prev.map((it) => (it.name === p.name ? { ...it, qty: it.qty + 1 } : it))
      }
      return [
        ...prev,
        {
          name: p.name,
          qty: 1,
          price: Number(p.price),
          kind: 'labor',
          maintenanceType: (p.maintenanceType ?? 'REPAIR') as MotoServiceItem['maintenanceType'],
          intervalKm: p.intervalKm,
          intervalDays: p.intervalDays,
        },
      ]
    })
  }

  const toggleSymptom = (s: string) =>
    setSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  const startOrder = async () => {
    if (!confirmedQuote) {
      setErr(t('confirmQuote'))
      return
    }
    setBusy(true)
    setErr('')
    try {
      const r = await createMotoOrder({
        plate,
        vehicleId: vehicle?.id,
        brand,
        model,
        year: year ? Number(year) : null,
        mileage: mileage !== '' ? Number(mileage) : null,
        ownerName,
        ownerPhone,
        symptoms: [...symptoms, customSymptom.trim()].filter(Boolean),
        items: services,
        discount,
        estimatedDue,
        photos,
        idempotencyKey: `${plate}-${Date.now()}`,
      })
      setDone(true)
      onDone?.({ displayNo: r.displayNo })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '开单失败')
    } finally {
      setBusy(false)
    }
  }

  // —— 步骤渲染 ——
  const stepDots = (
    <div className="mb-3 flex items-center justify-center gap-1.5">
      {Array.from({ length: 8 }).map((_, i) => (
        <button
          key={i}
          onClick={() => i < step && setStep(i)}
          className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-amber-500' : i < step ? 'w-3 bg-amber-300' : 'w-3 bg-zinc-200 dark:bg-zinc-700'}`}
        />
      ))}
    </div>
  )

  // 车牌已在手（开单完成后「继续开单」也回到这里）
  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="text-4xl">✅</span>
        <p className="text-lg font-medium">{t('orderDone')}</p>
        <button
          onClick={() => {
            setDone(false)
            setServices([])
            setSymptoms([])
            setDiscount(0)
            setEstimatedDue('')
            setPhotos([])
            setCustomSymptom('')
            setConfirmedQuote(false)
            setStep(0)
            setVehicle(null)
            setPlate('')
          }}
          className="rounded-xl bg-amber-500 px-6 py-3 font-medium text-white"
        >
          {t('newOrderAgain')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {onBack && step === 0 && (
        <button onClick={onBack} className="self-start text-sm text-zinc-500">← {t('back')}</button>
      )}
      {stepDots}

      {step === 0 && (
        <div className="flex flex-col gap-3">
          <PlateSearch
            onFound={(v) => {
              setVehicle(v)
              setPlate(v.plate)
              setBrand(v.brand ?? '')
              setModel(v.model ?? '')
              setYear(v.year ? String(v.year) : '')
              setMileage(v.mileage != null ? String(v.mileage) : '')
              setOwnerName(v.ownerName ?? '')
              setOwnerPhone(v.ownerPhone ?? '')
              setStep(1)
            }}
            onNotFound={(p) => {
              setVehicle(null)
              setPlate(p)
              setStep(1)
            }}
          />
          <PlateCamera
            hint={t('cameraHint')}
            onResult={(r) => {
              if (r.plate) {
                setPlate(r.plate)
                setStep(1)
              }
            }}
          />
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {vehicle ? t('pickVehicle') : `${t('newVehicle')} · ${plate}`}
          </div>
          {!vehicle && commonModels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {commonModels.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    const [b, ...rest] = m.split(' ')
                    setBrand(b)
                    setModel(rest.join(' '))
                  }}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          <VehicleForm
            initial={vehicle}
            defaultPlate={plate}
            onSaved={(v) => {
              setVehicle(v)
              setStep(2)
            }}
          />
          <button onClick={() => setStep(0)} className="text-sm text-zinc-500">← {t('back')}</button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('symptoms')}</div>
          <div className="flex flex-wrap gap-2">
            {(COMMON_SYMPTOMS[locale] ?? COMMON_SYMPTOMS.vi).map((s) => (
              <button
                key={s}
                onClick={() => toggleSymptom(s)}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  symptoms.includes(s)
                    ? 'border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'border-zinc-200 dark:border-zinc-700'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <input
            value={customSymptom}
            onChange={(e) => setCustomSymptom(e.target.value)}
            placeholder={t('customSymptom')}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button onClick={() => setStep(3)} className="rounded-xl bg-amber-500 px-4 py-3 font-medium text-white">
            {t('continue')} →
          </button>
          <button onClick={() => setStep(1)} className="text-sm text-zinc-500">← {t('back')}</button>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('service')}</div>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.serviceKey}
                onClick={() => addService(p)}
                className={`rounded-xl border px-4 py-3 text-sm ${
                  services.some((s) => s.name === p.name)
                    ? 'border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'border-zinc-200 dark:border-zinc-700'
                }`}
              >
                <span className="block font-medium">{p.name}</span>
                <span className="text-xs text-zinc-500">{formatPrice(Number(p.price), shop.currency)}</span>
              </button>
            ))}
          </div>

          {services.length > 0 && (
            <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {services.map((it, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="block truncate">{it.name}</span>
                    <span className="text-xs text-zinc-400">
                      {it.kind === 'part' ? t('partFee') : t('laborFee')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setServices((prev) =>
                          prev.flatMap((x, i) =>
                            i === idx ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x],
                          ),
                        )
                      }
                      className="h-7 w-7 rounded-lg border border-zinc-200 dark:border-zinc-700"
                    >
                      −
                    </button>
                    <span className="w-6 text-center">{it.qty}</span>
                    <button
                      onClick={() =>
                        setServices((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: x.qty + 1 } : x)))
                      }
                      className="h-7 w-7 rounded-lg border border-zinc-200 dark:border-zinc-700"
                    >
                      +
                    </button>
                    <span className="w-20 text-right font-medium">
                      {formatPrice(it.price * it.qty, shop.currency)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button onClick={() => setStep(4)} className="rounded-xl bg-amber-500 px-4 py-3 font-medium text-white">
            {t('continue')} →
          </button>
          <button onClick={() => setStep(2)} className="text-sm text-zinc-500">← {t('back')}</button>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('quote')}</div>
          <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            <div className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-zinc-500">{t('partFee')}</span>
              <span className="font-medium">{formatPrice(partFee, shop.currency)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-zinc-500">{t('laborFee')}</span>
              <span className="font-medium">{formatPrice(laborFee, shop.currency)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-zinc-500">{t('discount')}</span>
              <span className="font-medium">−{formatPrice(discount, shop.currency)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 text-base font-bold">
              <span>{t('total')}</span>
              <span>{formatPrice(total, shop.currency)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={discount || ''}
              onChange={(e) => setDiscount(Math.max(Number(e.target.value.replace(/\D/g, '')), 0))}
              inputMode="numeric"
              placeholder={t('discount')}
              className="w-32 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              onClick={() => setDiscount(Math.floor(subtotal / 1000) * 1000 >= 0 ? subtotal - Math.floor(subtotal / 1000) * 1000 : 0)}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm dark:border-zinc-700"
            >
              {t('roundDown')}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmedQuote} onChange={(e) => setConfirmedQuote(e.target.checked)} className="h-4 w-4" />
            {t('confirmQuote')}
          </label>
          <button onClick={() => setStep(5)} className="rounded-xl bg-amber-500 px-4 py-3 font-medium text-white">
            {t('continue')} →
          </button>
          <button onClick={() => setStep(3)} className="text-sm text-zinc-500">← {t('back')}</button>
        </div>
      )}

      {step === 5 && (
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('estimatedTime')}</div>
          <div className="grid grid-cols-2 gap-2">
            {TIME_SLOTS.map((slot) => (
              <button
                key={slot}
                onClick={() => setEstimatedDue(t(slot))}
                className={`rounded-xl border px-4 py-3 text-sm ${
                  estimatedDue === t(slot)
                    ? 'border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'border-zinc-200 dark:border-zinc-700'
                }`}
              >
                {t(slot)}
              </button>
            ))}
          </div>
          <button onClick={() => setStep(6)} className="rounded-xl bg-amber-500 px-4 py-3 font-medium text-white">
            {t('continue')} →
          </button>
          <button onClick={() => setStep(4)} className="text-sm text-zinc-500">← {t('back')}</button>
        </div>
      )}

      {step === 6 && (
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('customerPhone')}</div>
          <input
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(e.target.value)}
            inputMode="tel"
            placeholder={t('customerPhone')}
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-lg outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            onClick={() => setStep(7)}
            className="rounded-xl border border-zinc-200 py-3 text-sm text-zinc-500 dark:border-zinc-700"
          >
            {t('skip')}
          </button>
          <button onClick={() => setStep(5)} className="text-sm text-zinc-500">← {t('back')}</button>
        </div>
      )}

      {step === 7 && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <div className="flex justify-between py-1"><span className="text-zinc-500">{t('plate')}</span><span className="font-bold tracking-wider">{plate}</span></div>
            {brand && <div className="flex justify-between py-1"><span className="text-zinc-500">{t('brand')}</span><span>{brand} {model}</span></div>}
            {symptoms.length > 0 && <div className="flex justify-between py-1"><span className="text-zinc-500">{t('symptoms')}</span><span>{symptoms.join('、')}</span></div>}
            <div className="flex justify-between py-1"><span className="text-zinc-500">{t('service')}</span><span>{services.length} 项</span></div>
            {estimatedDue && <div className="flex justify-between py-1"><span className="text-zinc-500">{t('estimatedTime')}</span><span>{estimatedDue}</span></div>}
            <div className="mt-1 flex justify-between border-t border-zinc-200 pt-2 text-base font-bold dark:border-zinc-700">
              <span>{t('total')}</span><span>{formatPrice(total, shop.currency)}</span>
            </div>
          </div>
          <button
            onClick={startOrder}
            disabled={busy || services.length === 0}
            className="rounded-xl bg-amber-500 px-4 py-4 text-lg font-bold text-white disabled:opacity-50"
          >
            {busy ? '…' : `🚀 ${t('start')}`}
          </button>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button onClick={() => setStep(6)} className="text-sm text-zinc-500">← {t('back')}</button>
        </div>
      )}
    </div>
  )
}
