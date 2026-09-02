'use client'
// L3 三模式快速开单：公斤（大键盘+快捷量）/ 按件 / 洗鞋（款式+增值）
// 计价客户端展示、服务端重算（createLaundryOrder 不信任客户端价）。标签码服务端自增生成。
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createLaundryOrder } from '@/lib/laundry-actions'
import { formatPrice } from '@/lib/format'
import type { LaundryMode, LaundryShop, ShoeStyle } from './types'

const QUICK_KG = [5, 8, 10]
const SHOE_STYLES: ShoeStyle[] = ['sport', 'leather', 'suede']

export function QuickLaundry({ shop, onDone, onBack }: { shop: LaundryShop; onDone: () => void; onBack: () => void }) {
  const t = useTranslations('laundry')
  const rates = shop.config?.laundryRates
  const [mode, setMode] = useState<LaundryMode>('kg')
  const [kg, setKg] = useState<number>(5)
  const [itemQty, setItemQty] = useState<Record<string, number>>({})
  const [shoeStyle, setShoeStyle] = useState<ShoeStyle>('sport')
  const [shoeAddons, setShoeAddons] = useState<string[]>([])
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [note, setNote] = useState('')
  const [discount, setDiscount] = useState(0)
  const [paid, setPaid] = useState(0)
  const [dispatchType, setDispatchType] = useState<'in_store' | 'pickup' | 'deliver'>('in_store')
  const [dispatchAddress, setDispatchAddress] = useState('')
  const [timeWindow, setTimeWindow] = useState('')
  const [careType, setCareType] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 客户端预估 total（仅展示；真正下单由服务端按 rates 重算）
  const estTotal = useMemo(() => {
    if (!rates) return 0
    if (mode === 'kg') return Math.round(kg * (rates.kgRate ?? 0))
    if (mode === 'item')
      return (rates.itemRates ?? []).reduce((s, r) => s + r.price * (itemQty[r.name] ?? 0), 0)
    const base = rates.shoeBase?.[shoeStyle] ?? 0
    const add = (shoeAddons ?? []).reduce(
      (s, n) => s + (rates.shoeAddons?.find((a) => a.name === n)?.price ?? 0),
      0,
    )
    return base + add
  }, [rates, mode, kg, itemQty, shoeStyle, shoeAddons, discount])

  const finalTotal = Math.max(estTotal - discount, 0)

  const setQty = (name: string, d: number) =>
    setItemQty((s) => ({ ...s, [name]: Math.max((s[name] ?? 0) + d, 0) }))
  const toggleAddon = (name: string) =>
    setShoeAddons((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]))

  const submit = async () => {
    setBusy(true)
    setErr('')
    const idempotencyKey = crypto.randomUUID()
    try {
      await createLaundryOrder({
        mode,
        kg: mode === 'kg' ? kg : undefined,
        itemSelections:
          mode === 'item'
            ? (rates?.itemRates ?? [])
                .map((r) => ({ name: r.name, qty: itemQty[r.name] ?? 0 }))
                .filter((s) => s.qty > 0)
            : undefined,
        shoeStyle: mode === 'shoe' ? shoeStyle : undefined,
        shoeAddons: mode === 'shoe' ? shoeAddons : undefined,
        customerPhone: customerPhone || undefined,
        customerName: customerName || undefined,
        note: note || undefined,
        discount,
        paidAmount: paid,
        careType: careType || undefined,
        dispatchType: dispatchType !== 'in_store' ? dispatchType : undefined,
        address: dispatchType !== 'in_store' ? dispatchAddress || undefined : undefined,
        timeWindow: timeWindow || undefined,
        idempotencyKey,
      })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('error'))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 模式切换 */}
      <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {(['kg', 'item', 'shoe'] as LaundryMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${
              mode === m ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'
            }`}
          >
            {m === 'kg' ? t('modeKg') : m === 'item' ? t('modeItem') : t('modeShoe')}
          </button>
        ))}
      </div>

      {/* 公斤模式：大键盘 + 快捷量 */}
      {mode === 'kg' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-center gap-2 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
            <button onClick={() => setKg(Math.max(kg - 1, 0))} className="h-12 w-12 rounded-lg bg-white text-xl font-bold dark:bg-zinc-800">
              −
            </button>
            <span className="min-w-32 text-center text-5xl font-extrabold">{kg}</span>
            <button onClick={() => setKg(kg + 1)} className="h-12 w-12 rounded-lg bg-white text-xl font-bold dark:bg-zinc-800">
              ＋
            </button>
          </div>
          <div className="flex gap-2">
            {QUICK_KG.map((q) => (
              <button
                key={q}
                onClick={() => setKg(q)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
                  kg === q ? 'bg-amber-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800'
                }`}
              >
                {q}kg
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
            <span className="text-sm text-zinc-500">{t('kgRateLabel')}</span>
            <span className="text-sm font-semibold">{formatPrice(rates?.kgRate ?? 0, shop.currency)}/kg</span>
          </div>
        </div>
      )}

      {/* 按件模式 */}
      {mode === 'item' && (
        <div className="flex flex-col gap-2">
          {(rates?.itemRates ?? []).map((r) => (
            <div key={r.name} className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
              <div>
                <span className="text-sm font-semibold">{r.name}</span>
                <span className="ml-2 text-xs text-zinc-400">{formatPrice(r.price, shop.currency)}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setQty(r.name, -1)} className="h-8 w-8 rounded-lg bg-white text-lg font-bold dark:bg-zinc-800">
                  −
                </button>
                <span className="min-w-6 text-center text-sm font-bold">{itemQty[r.name] ?? 0}</span>
                <button onClick={() => setQty(r.name, 1)} className="h-8 w-8 rounded-lg bg-white text-lg font-bold dark:bg-zinc-800">
                  ＋
                </button>
              </div>
            </div>
          ))}
          {(rates?.itemRates ?? []).length === 0 && <p className="text-center text-sm text-zinc-400">{t('noItemRates')}</p>}
        </div>
      )}

      {/* 洗鞋模式 */}
      {mode === 'shoe' && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            {SHOE_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setShoeStyle(s)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
                  shoeStyle === s ? 'bg-amber-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800'
                }`}
              >
                {s === 'sport' ? t('shoeSport') : s === 'leather' ? t('shoeLeather') : t('shoeSuede')}
              </button>
            ))}
          </div>
          {(rates?.shoeAddons ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(rates?.shoeAddons ?? []).map((a) => (
                <button
                  key={a.name}
                  onClick={() => toggleAddon(a.name)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    shoeAddons.includes(a.name) ? 'bg-amber-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800'
                  }`}
                >
                  {a.name} +{formatPrice(a.price, shop.currency)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* P2 取送 + 护理类型 */}
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex gap-2">
          {(['in_store', 'pickup', 'deliver'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDispatchType(d)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                dispatchType === d ? 'bg-amber-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800'
              }`}
            >
              {d === 'in_store' ? t('dispatchInStore') : d === 'pickup' ? t('dispatchPickup') : t('dispatchDeliver')}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">{t('careType')}</span>
            <select value={careType} onChange={(e) => setCareType(e.target.value)} className="flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              <option value="">{t('careNormal')}</option>
              <option value="dryclean">{t('careDryClean')}</option>
              <option value="handwash">{t('careHandWash')}</option>
              <option value="delicate">{t('careDelicate')}</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">{t('timeWindow')}</span>
            <input value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)} placeholder="08-12h" className="flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
          </div>
        </div>
        {dispatchType !== 'in_store' && (
          <input value={dispatchAddress} onChange={(e) => setDispatchAddress(e.target.value)} placeholder={t('address')} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
        )}
        {dispatchType !== 'in_store' && (shop.config?.deliveryFee ?? 0) > 0 && (
          <p className="text-xs text-zinc-500">{t('deliveryFee')}: +{formatPrice(shop.config?.deliveryFee ?? 0, shop.currency)}</p>
        )}
      </div>

      {/* 顾客 + 备注 */}
      <div className="grid grid-cols-1 gap-2">
        <input
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          placeholder={t('customerPhone')}
          inputMode="tel"
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder={t('customerName')}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('note')}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </div>

      {/* 折扣 / 今收 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <span className="text-xs text-zinc-500">{t('discount')}</span>
          <input
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value) || 0)}
            inputMode="decimal"
            className="w-full bg-transparent text-sm font-semibold outline-none"
          />
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <span className="text-xs text-zinc-500">{t('paidNow')}</span>
          <input
            value={paid}
            onChange={(e) => setPaid(Number(e.target.value) || 0)}
            inputMode="decimal"
            className="w-full bg-transparent text-sm font-semibold outline-none"
          />
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* 提交 */}
      <div className="mt-2 flex gap-2">
        <button onClick={onBack} className="rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-zinc-700">
          {t('back')}
        </button>
        <button
          onClick={submit}
          disabled={busy || estTotal <= 0}
          className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-3 text-sm font-semibold text-white shadow-md shadow-amber-500/20 disabled:opacity-50"
        >
          {t('submit')} · {formatPrice(finalTotal, shop.currency)}
        </button>
      </div>
    </div>
  )
}
