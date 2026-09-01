'use client'
// 公开自助开店表单（2026-09-01 #4）：店名+垂直+城市+老板手机+密码 → openShopApplication → 建待审/直接开业。
// 只收用户拍板的「基础四字段」；slug/currency/plan/trialDays 等由 action 自动默认。
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { openShopApplication } from '@/lib/open-shop-actions'
import { type Vertical, VERTICALS } from '@/lib/vertical'
import { CITY_OPTIONS, DEFAULT_CITY, type CitySlug } from '@/lib/city'

const inputCls =
  'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800'

const VERTICAL_OPTIONS: { value: Vertical; labelKey: string }[] = VERTICALS.map((v) => ({
  value: v,
  labelKey: 'vertical' + v[0] + v.slice(1).toLowerCase(),
}))

export function OpenShopForm() {
  const t = useTranslations('open')
  const ta = useTranslations('admin')
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [vertical, setVertical] = useState<Vertical>('FOOD')
  const [city, setCity] = useState<CitySlug>(DEFAULT_CITY)
  const [ownerPhone, setOwnerPhone] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState<{ approved: boolean } | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    startTransition(async () => {
      try {
        const res = await openShopApplication({
          name,
          vertical,
          city,
          ownerPhone,
          ownerPassword,
        })
        setDone(res)
      } catch (e2) {
        console.error('自助开店失败:', e2)
        setErr(e2 instanceof Error && e2.message ? e2.message : t('errorGeneric'))
      }
    })
  }

  // 提交成功：按是否需审核给不同提示 + 返回入口
  if (done) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-lg font-semibold">
          {done.approved ? t('successApproved') : t('successReview')}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('successHint')}</p>
        <div className="flex justify-center gap-3">
          <Link
            href="/login"
            className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98]"
          >
            {t('goLogin')}
          </Link>
          <Link
            href="/"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {t('backHome')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
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

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('vertical')}</span>
          <select
            value={vertical}
            onChange={(e) => setVertical(e.target.value as Vertical)}
            className={inputCls}
          >
            {VERTICAL_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>
                {ta(v.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('city')}</span>
          <select
            value={city}
            onChange={(e) => setCity(e.target.value as CitySlug)}
            className={inputCls}
          >
            {CITY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

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
          placeholder="≥8 位"
          className={inputCls}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
      >
        {t('submit')}
      </button>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
    </form>
  )
}
