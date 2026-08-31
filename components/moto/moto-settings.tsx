'use client'
// M4.3 设置（moto 分支）：本店服务预设增删（从预设库/自建）/ 常见车型 / 收款信息 / 店铺信息
// 垂直差异全进 Shop.config（presets/commonModels/payment），dashboard/seed 同源读取
import { useCallback, useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  addShopMotoPreset,
  removeShopMotoPreset,
  getMotoPresetCatalog,
  saveMotoSettings,
  saveMotoShopInfo,
  type MotoPresetItemPlain,
} from '@/lib/moto-actions'
import type { MotoShop } from './types'
import { absoluteUrl, shopSubUrl } from '@/lib/urls'
import { useToast, ToastView } from '../dashboard/use-toast'

type CatalogItem = {
  serviceKey: string
  nameVi: string
  nameZh: string
  nameEn: string
  price: string
  unit?: string | null
  category?: string
  maintenanceType?: string
  intervalKm?: number | null
  intervalDays?: number | null
}

type PaymentForm = {
  bank?: { bankName?: string; accountNo?: string; accountName?: string }
  wallet?: { momoQrUrl?: string; zalopayQrUrl?: string }
}

export function MotoSettings({ shop, onSaved }: { shop: MotoShop; onSaved: () => void }) {
  const t = useTranslations('moto')
  const locale = useLocale()
  const { msg, show } = useToast()

  // —— 本店服务预设 ——
  const [presets, setPresets] = useState<MotoPresetItemPlain[]>(shop.config?.presets ?? [])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [selected, setSelected] = useState('')
  const [customName, setCustomName] = useState('')
  const [customPrice, setCustomPrice] = useState('')

  // —— 常见车型 ——
  const [models, setModels] = useState<string[]>(shop.config?.commonModels ?? [])
  const [modelInput, setModelInput] = useState('')

  // —— 收款信息 ——
  const [payment, setPayment] = useState<PaymentForm>((shop.config?.payment as PaymentForm) ?? {})
  const [bankName, setBankName] = useState(payment.bank?.bankName ?? '')
  const [accountNo, setAccountNo] = useState(payment.bank?.accountNo ?? '')
  const [accountName, setAccountName] = useState(payment.bank?.accountName ?? '')
  const [momoQr, setMomoQr] = useState(payment.wallet?.momoQrUrl ?? '')
  const [zalopayQr, setZalopayQr] = useState(payment.wallet?.zalopayQrUrl ?? '')

  // —— 店铺信息 ——
  const [name, setName] = useState(shop.name)
  const [phone, setPhone] = useState(shop.phone ?? '')

  const loadCatalog = useCallback(async () => {
    try {
      const rows = await getMotoPresetCatalog()
      setCatalog(rows)
      setSelected((prev) => prev || (rows[0]?.serviceKey ?? ''))
    } catch {
      /* 忽略 */
    }
  }, [])
  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  const addPreset = async (item: MotoPresetItemPlain) => {
    try {
      await addShopMotoPreset(item)
      setPresets((prev) =>
        prev.some((p) => p.serviceKey === item.serviceKey) ? prev : [...prev, item],
      )
      show(t('toastSaved'))
    } catch {
      show(t('toastError'))
    }
  }

  const removePreset = async (serviceKey: string) => {
    if (!confirm(t('removeConfirm'))) return
    try {
      await removeShopMotoPreset(serviceKey)
      setPresets((prev) => prev.filter((p) => p.serviceKey !== serviceKey))
      show(t('toastSaved'))
    } catch {
      show(t('toastError'))
    }
  }

  const addModel = () => {
    const v = modelInput.trim()
    if (!v) return
    setModels((prev) => (prev.includes(v) ? prev : [...prev, v]))
    setModelInput('')
  }

  const saveAll = async () => {
    try {
      await saveMotoSettings({
        commonModels: models,
        payment: {
          bank: { bankName, accountNo, accountName },
          wallet: { momoQrUrl: momoQr, zalopayQrUrl: zalopayQr },
        },
      })
      await saveMotoShopInfo({ name, phone })
      show(t('toastSaved'))
      onSaved()
    } catch {
      show(t('toastError'))
    }
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900'

  return (
    <div className="flex flex-col gap-4">
      {/* 本店服务预设 */}
      <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">
          {t('settingsPresets')}
        </h2>
        {presets.length === 0 ? (
          <p className="text-sm text-zinc-400">{t('emptyPresets')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <span
                key={p.serviceKey}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-sm dark:border-zinc-700"
              >
                {p.name}
                <button
                  onClick={() => removePreset(p.serviceKey)}
                  className="text-zinc-400 hover:text-red-500"
                  aria-label={t('removePreset')}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t('addFromCatalog')}
            <select
              className={inputCls}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {catalog.map((c) => (
                <option key={c.serviceKey} value={c.serviceKey}>
                  {locale === 'zh' ? c.nameZh : locale === 'en' ? c.nameEn : c.nameVi}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              const c = catalog.find((x) => x.serviceKey === selected)
              if (c) addPreset({ ...c, name: c.nameVi })
            }}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white"
          >
            {t('add')}
          </button>
          <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-700" />
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t('customService')}
            <input
              className={inputCls}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={t('serviceName')}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t('price')}
            <input
              className={`${inputCls} w-24`}
              type="number"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              const name2 = customName.trim()
              if (!name2) return
              const key = `custom_${Date.now()}`
              addPreset({
                serviceKey: key,
                name: name2,
                price: customPrice || '0',
              })
              setCustomName('')
              setCustomPrice('')
            }}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            {t('add')}
          </button>
        </div>
      </section>

      {/* 常见车型 */}
      <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">
          {t('settingsModels')}
        </h2>
        {models.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-sm dark:border-zinc-700"
              >
                {m}
                <button
                  onClick={() => setModels((prev) => prev.filter((x) => x !== m))}
                  className="text-zinc-400 hover:text-red-500"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            className={inputCls}
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addModel()
              }
            }}
            placeholder={t('modelPlaceholder')}
          />
          <button
            onClick={addModel}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            {t('add')}
          </button>
        </div>
      </section>

      {/* 收款信息 */}
      <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">
          {t('settingsPayment')}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t('bankName')}
            <input
              className={inputCls}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t('accountNo')}
            <input
              className={inputCls}
              value={accountNo}
              onChange={(e) => setAccountNo(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t('accountName')}
            <input
              className={inputCls}
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t('momoQr')}
            <input
              className={inputCls}
              value={momoQr}
              onChange={(e) => setMomoQr(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t('zalopayQr')}
            <input
              className={inputCls}
              value={zalopayQr}
              onChange={(e) => setZalopayQr(e.target.value)}
            />
          </label>
        </div>
      </section>

      {/* 店铺信息 */}
      <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">
          {t('settingsShop')}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t('shopName')}
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t('shopPhone')}
            <input
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
        </div>
        {/* M6a 6.2 店码：客户入口链接（只读文本，发车主扫码查进度；MVP 不引 qrcode 依赖） */}
        <div className="flex flex-col gap-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <span className="text-xs text-zinc-500">{t('customerLink')}</span>
          <code className="break-all rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs dark:bg-zinc-800">
            {typeof window !== 'undefined'
              ? absoluteUrl(shopSubUrl({ vertical: shop.vertical, slug: shop.slug, city: shop.city }, 'lookup'))
              : shopSubUrl({ vertical: shop.vertical, slug: shop.slug, city: shop.city }, 'lookup')}
          </code>
        </div>
      </section>

      <button
        onClick={saveAll}
        className="rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        {t('saveAll')}
      </button>
      <ToastView msg={msg} />
    </div>
  )
}
