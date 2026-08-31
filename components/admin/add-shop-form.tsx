'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { createShop } from '@/lib/admin-actions'
import { type Vertical } from '@/lib/vertical'
import { routing } from '@/i18n/routing'
import { useToast, ToastView } from '../dashboard/use-toast'

// 币种 / 套餐选项（套餐 TRIAL/BASIC/PRO；第 20 批起 vertical 开放全部 5 垂直）
const CURRENCIES = ['VND', 'USD', 'EUR', 'SGD', 'CNY'] as const
const PLANS = ['TRIAL', 'BASIC', 'PRO'] as const

// 垂直类目（SaaS 附加的 App 即这些垂直；FOOD 先行，其余为模板扩展位）
// value 以 Vertical 类型约束（与 lib/vertical.ts 同源）；labelKey 走 admin namespace 多语
const VERTICAL_OPTIONS: { value: Vertical; labelKey: string }[] = [
  { value: 'FOOD', labelKey: 'verticalFood' },
  { value: 'MOTO', labelKey: 'verticalMoto' },
  { value: 'SALON', labelKey: 'verticalSalon' },
  { value: 'PET', labelKey: 'verticalPet' },
  { value: 'LAUNDRY', labelKey: 'verticalLaundry' },
]

// slug 保留字（前端即时校验，与服务端 admin-actions 保持一致）
const RESERVED_SLUGS = new Set([
  'admin',
  'login',
  'dashboard',
  'api',
  's',
  'track',
  'zh',
  'zh-hant',
  'en',
  'vi',
  'ms',
  'th',
  'manifest',
  'sw',
])

const inputCls =
  'rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800'

// 建店 + 老板账号一表单（受控 useState + useTransition + server action + toast，照抄 settings-panel AddProductForm 模式）
// defaultTrialDays：平台 billing.trialDays 配置传入作表单默认（未配 = 30，兼容现状）
export function AddShopForm({ defaultTrialDays }: { defaultTrialDays?: number }) {
  const t = useTranslations('admin')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const { msg, show } = useToast()

  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [vertical, setVertical] = useState<Vertical>('FOOD')
  const [currency, setCurrency] = useState<string>('VND')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [openHours, setOpenHours] = useState('')
  const [minOrderAmount, setMinOrderAmount] = useState('')
  const [plan, setPlan] = useState<string>('TRIAL')
  const [trialDays, setTrialDays] = useState(String(defaultTrialDays ?? 30))
  const [ownerPhone, setOwnerPhone] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [nameI18n, setNameI18n] = useState<Record<string, string>>({})

  // 非英文 locale 的翻译框（主文案 name 为英文 canonical）
  const translateLocales = routing.locales.filter((l) => l !== 'en')

  const slugValid =
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) &&
    slug.length >= 3 &&
    slug.length <= 30 &&
    !RESERVED_SLUGS.has(slug)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!slugValid) {
      show(t('slugInvalid'))
      return
    }
    startTransition(async () => {
      try {
        await createShop({
          slug,
          name,
          vertical,
          currency,
          phone: phone || null,
          address: address || null,
          openHours: openHours || null,
          minOrderAmount: Number(minOrderAmount) || 0,
          plan,
          trialDays: Number(trialDays) || 0,
          nameI18n: Object.fromEntries(
            Object.entries(nameI18n).filter(([, v]) => v.trim()),
          ),
          ownerPhone,
          ownerPassword,
        })
        // 清空表单（保留 currency/plan/trialDays 默认值，便于连续建店）
        setSlug('')
        setName('')
        setPhone('')
        setAddress('')
        setOpenHours('')
        setMinOrderAmount('')
        setOwnerPhone('')
        setOwnerPassword('')
        setNameI18n({})
        show(t('toastCreated'))
        router.refresh()
      } catch (e) {
        console.error('建店失败:', e)
        show(e instanceof Error && e.message ? e.message : t('toastError'))
      }
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h3 className="text-sm font-medium">{t('addShopTitle')}</h3>

      {/* 店铺信息 */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('name')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('slug')}</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            placeholder="demo-pho"
            className={inputCls}
          />
          {slug && !slugValid && (
            <span className="text-xs text-red-500">{t('slugInvalid')}</span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('vertical')}</span>
          <select
            value={vertical}
            onChange={(e) => setVertical(e.target.value as Vertical)}
            className={inputCls}
          >
            {VERTICAL_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>
                {t(v.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('currency')}</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputCls}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('phone')}</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('address')}</span>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('openHours')}</span>
          <input
            type="text"
            value={openHours}
            onChange={(e) => setOpenHours(e.target.value)}
            placeholder="07:00-22:00"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('minOrderAmount')}</span>
          <input
            type="number"
            value={minOrderAmount}
            onChange={(e) => setMinOrderAmount(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('plan')}</span>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className={inputCls}
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {t(`plan${p.charAt(0)}${p.slice(1).toLowerCase()}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('trialDays')}</span>
          <input
            type="number"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      {/* 店名多语翻译框（按 routing.locales 动态生成非英文 locale） */}
      {translateLocales.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-zinc-500">{t('nameI18nHint')}</span>
          {translateLocales.map((loc) => (
            <label key={loc} className="flex items-center gap-2 text-sm">
              <span className="w-8 text-zinc-600 dark:text-zinc-400">
                {loc.toUpperCase()}
              </span>
              <input
                type="text"
                value={nameI18n[loc] ?? ''}
                onChange={(e) =>
                  setNameI18n((prev) => ({ ...prev, [loc]: e.target.value }))
                }
                className={inputCls}
              />
            </label>
          ))}
        </div>
      )}

      {/* 老板账号 */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('ownerPhone')}</span>
          <input
            type="tel"
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(e.target.value)}
            required
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('ownerPassword')}</span>
          <input
            type="password"
            value={ownerPassword}
            onChange={(e) => setOwnerPassword(e.target.value)}
            required
            className={inputCls}
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
      >
        {t('create')}
      </button>
      <ToastView msg={msg} />
    </form>
  )
}
