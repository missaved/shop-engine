'use client'
// L5 设置·配价（L_RATE）：公斤单价 / 按件价 / 洗鞋款式底价 / 增值项。老板在设置里随时改。
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { saveLaundrySettings } from '@/lib/laundry-actions'
import { shopSubUrl, absoluteUrl } from '@/lib/urls'
import type { LaundryRates, LaundryShop, ShoeStyle } from './types'
import { LaundryMembership } from './laundry-membership'

const SHOE_STYLES: ShoeStyle[] = ['sport', 'leather', 'suede']

export function LaundrySettings({ shop }: { shop: LaundryShop }) {
  const t = useTranslations('laundry')
  const init = shop.config?.laundryRates
  const [rates, setRates] = useState<LaundryRates>({
    kgRate: init?.kgRate ?? 0,
    itemRates: init?.itemRates ?? [],
    shoeBase: init?.shoeBase ?? { sport: 0, leather: 0, suede: 0 },
    shoeAddons: init?.shoeAddons ?? [],
  })
  const [deliveryFee, setDeliveryFee] = useState(shop.config?.deliveryFee ?? 0)
  const [careSurcharge, setCareSurcharge] = useState(shop.config?.careSurcharge ?? 0)
  const [extraCategories, setExtraCategories] = useState<{ key: string; name: string; price: number; unit: string }[]>(
    shop.config?.extraCategories ?? [],
  )
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = (patch: Partial<LaundryRates>) => setRates((r) => ({ ...r, ...patch }))

  const addItemRate = () =>
    setRates((r) => ({ ...r, itemRates: [...r.itemRates, { name: '', price: 0 }] }))
  const setItemRate = (i: number, patch: Partial<{ name: string; price: number }>) =>
    setRates((r) => ({
      ...r,
      itemRates: r.itemRates.map((it, idx) => (idx === i ? { ...it, ...patch } : it)),
    }))
  const addShoeAddon = () => setRates((r) => ({ ...r, shoeAddons: [...r.shoeAddons, { name: '', price: 0 }] }))
  const setShoeAddon = (i: number, patch: Partial<{ name: string; price: number }>) =>
    setRates((r) => ({
      ...r,
      shoeAddons: r.shoeAddons.map((a, idx) => (idx === i ? { ...a, ...patch } : a)),
    }))

  const save = async () => {
    setBusy(true)
    try {
      const clean = {
        kgRate: Number(rates.kgRate) || 0,
        itemRates: rates.itemRates.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), price: Number(r.price) || 0 })),
        shoeBase: {
          sport: Number(rates.shoeBase.sport) || 0,
          leather: Number(rates.shoeBase.leather) || 0,
          suede: Number(rates.shoeBase.suede) || 0,
        },
        shoeAddons: rates.shoeAddons.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), price: Number(a.price) || 0 })),
      }
      await saveLaundrySettings({
        laundryRates: clean,
        deliveryFee: Number(deliveryFee) || 0,
        careSurcharge: Number(careSurcharge) || 0,
        extraCategories: extraCategories
          .filter((c) => c.name.trim())
          .map((c) => ({ key: c.name.trim(), name: c.name.trim(), price: Number(c.price) || 0, unit: c.unit || 'lần' })),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      alert(t('saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 公斤单价 */}
      <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('kgRateTitle')}</div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">{t('kgRate')}</span>
          <input
            value={rates.kgRate}
            onChange={(e) => set({ kgRate: Number(e.target.value) || 0 })}
            inputMode="decimal"
            className="w-28 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
          <span className="text-sm text-zinc-400">/kg</span>
        </div>
      </div>

      {/* 按件价 */}
      <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('itemRatesTitle')}</span>
          <button onClick={addItemRate} className="text-xs font-semibold text-amber-600">
            + {t('addRow')}
          </button>
        </div>
        {rates.itemRates.map((r, i) => (
          <div key={i} className="mb-2 flex items-center gap-2">
            <input
              value={r.name}
              onChange={(e) => setItemRate(i, { name: e.target.value })}
              placeholder={t('itemNamePlaceholder')}
              className="flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
            <input
              value={r.price}
              onChange={(e) => setItemRate(i, { price: Number(e.target.value) || 0 })}
              inputMode="decimal"
              placeholder="0"
              className="w-24 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
            <button
              onClick={() => setRates((s) => ({ ...s, itemRates: s.itemRates.filter((_, idx) => idx !== i) }))}
              className="text-zinc-400"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* 洗鞋款式底价 */}
      <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('shoeBaseTitle')}</div>
        <div className="grid grid-cols-3 gap-2">
          {SHOE_STYLES.map((s) => (
            <div key={s} className="flex flex-col items-center gap-1">
              <span className="text-xs text-zinc-500">
                {s === 'sport' ? t('shoeSport') : s === 'leather' ? t('shoeLeather') : t('shoeSuede')}
              </span>
              <input
                value={rates.shoeBase[s] ?? 0}
                onChange={(e) =>
                  setRates((r) => ({ ...r, shoeBase: { ...r.shoeBase, [s]: Number(e.target.value) || 0 } }))
                }
                inputMode="decimal"
                className="w-full rounded-lg border border-zinc-200 px-2 py-1 text-sm text-center dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
          ))}
        </div>
      </div>

      {/* 增值项 */}
      <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('shoeAddonsTitle')}</span>
          <button onClick={addShoeAddon} className="text-xs font-semibold text-amber-600">
            + {t('addRow')}
          </button>
        </div>
        {rates.shoeAddons.map((a, i) => (
          <div key={i} className="mb-2 flex items-center gap-2">
            <input
              value={a.name}
              onChange={(e) => setShoeAddon(i, { name: e.target.value })}
              placeholder={t('addonNamePlaceholder')}
              className="flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
            <input
              value={a.price}
              onChange={(e) => setShoeAddon(i, { price: Number(e.target.value) || 0 })}
              inputMode="decimal"
              placeholder="0"
              className="w-24 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
            <button
              onClick={() => setRates((s) => ({ ...s, shoeAddons: s.shoeAddons.filter((_, idx) => idx !== i) }))}
              className="text-zinc-400"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* P2 取送/增值/护理加价 */}
      <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('dispatchFeeTitle')}</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-zinc-500">{t('deliveryFee')}</span>
            <input value={deliveryFee} onChange={(e) => setDeliveryFee(Number(e.target.value) || 0)} inputMode="decimal" className="w-20 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-zinc-500">{t('careSurcharge')}</span>
            <input value={careSurcharge} onChange={(e) => setCareSurcharge(Number(e.target.value) || 0)} inputMode="decimal" className="w-20 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
          </div>
        </div>
        {/* 额外服务类目（熨烫/被褥/真皮/窗帘…） */}
        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">{t('extraCategories')}</span>
            <button
              onClick={() => setExtraCategories((a) => [...a, { key: '', name: '', price: 0, unit: 'lần' }])}
              className="text-xs font-semibold text-amber-600"
            >
              + {t('addRow')}
            </button>
          </div>
          {extraCategories.map((c, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <input value={c.name} onChange={(e) => setExtraCategories((a) => a.map((x, idx) => (idx === i ? { ...x, name: e.target.value, key: e.target.value } : x)))} placeholder={t('catNamePlaceholder')} className="flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
              <input value={c.price} onChange={(e) => setExtraCategories((a) => a.map((x, idx) => (idx === i ? { ...x, price: Number(e.target.value) || 0 } : x)))} inputMode="decimal" placeholder="0" className="w-24 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
              <button onClick={() => setExtraCategories((a) => a.filter((_, idx) => idx !== i))} className="text-zinc-400">✕</button>
            </div>
          ))}
        </div>
      </div>

      <LaundryMembership currency={shop.currency} />

      {/* 店码：顾客入口链接（发客户扫码/下单洗衣，只读文本，MVP 不引 qrcode 依赖） */}
      <div className="flex flex-col gap-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <span className="text-xs text-zinc-500">{t('customerLink')}</span>
        <code className="break-all rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs dark:bg-zinc-800">
          {typeof window !== 'undefined'
            ? absoluteUrl(shopSubUrl({ vertical: shop.vertical, slug: shop.slug, city: shop.city }, 'storefront'))
            : shopSubUrl({ vertical: shop.vertical, slug: shop.slug, city: shop.city }, 'storefront')}
        </code>
      </div>

      <button
        onClick={save}
        disabled={busy}
        className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-3 text-sm font-semibold text-white shadow-md shadow-amber-500/20 disabled:opacity-50"
      >
        {saved ? t('saved') : t('save')}
      </button>
    </div>
  )
}
