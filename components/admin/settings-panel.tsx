'use client'

// 中台设置中心（2026-08-29 设置中心扩展重构）：4 组 Tab × 13 块。
// 数据由 server 页 getSettingsData() 一次性传入（脱敏视图，敏感字段只回「已配置」布尔）。
// 每组块组件独立保存（合并式写入：留空 = 不修改），保存后 router.refresh 同步服务端数据。
import { useState, useTransition, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, useParams } from 'next/navigation'
import QRCode from 'react-qr-code'
import type { SettingsData } from '@/lib/admin-settings-actions'
import {
  saveSiteSettings,
  saveAiConfig,
  saveSecuritySettings,
  saveMaintenanceSettings,
  saveNotificationSettings,
  saveOnboardingSettings,
  saveBillingSettings,
  saveTier,
  deleteTier,
  saveAnnouncement,
  deleteAnnouncement,
  createApiKey,
  revokeApiKey,
  listAuditLogs,
} from '@/lib/admin-settings-actions'
import {
  disableAdminTotp,
  startAdminTotpSetup,
  confirmAdminTotp,
} from '@/lib/admin-actions'
import { routing } from '@/i18n/routing'
import { useThemeMode, type ThemeMode } from '@/components/theme-mode'

// ---- 通用样式与控件 ----

const cardCls =
  'flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900'
const inputCls =
  'rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800'
const btnCls =
  'rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60'
const dangerBtnCls =
  'rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20'
const hintCls = 'mt-1 text-xs text-zinc-500'

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className={cardCls}>
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <p className={hintCls}>{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Text({
  value,
  onChange,
  placeholder,
  type,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type ?? 'text'}
      className={`${inputCls} w-full`}
    />
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex items-start justify-between gap-3">
      <div>
        <span className="text-sm">{label}</span>
        {hint && <p className={hintCls}>{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-amber-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  )
}

function SaveBar({
  pending,
  msg,
  err,
  label,
  onSave,
}: {
  pending: boolean
  msg: string | null
  err: string | null
  label?: string
  onSave: () => void
}) {
  const t = useTranslations('admin')
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={onSave} disabled={pending} className={btnCls}>
        {pending ? t('setSaving') : label ?? t('setSave')}
      </button>
      {msg && <span className="text-sm text-green-600">{msg}</span>}
      {err && <span className="text-sm text-red-600">{err}</span>}
    </div>
  )
}

// 表单块通用保存状态（保存 → 成功提示 → 刷新服务端数据）
function useSave() {
  const router = useRouter()
  const t = useTranslations('admin')
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  function run(fn: () => Promise<void>) {
    setMsg(null)
    setErr(null)
    startTransition(async () => {
      try {
        await fn()
        setMsg(t('setSaved'))
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('toastError'))
      }
    })
  }
  return { pending, msg, err, run }
}

const LOCALE_NAMES: Record<string, string> = {
  zh: '简体中文',
  'zh-Hant': '繁體中文',
  en: 'English',
  vi: 'Tiếng Việt',
  ms: 'Bahasa Melayu',
  th: 'ไทย',
}

// ---- Tab 容器 ----

type TabId = 'base' | 'security' | 'ai' | 'open'

export function SettingsPanel({
  data,
  totpEnabled,
}: {
  data: SettingsData
  totpEnabled: boolean
}) {
  const t = useTranslations('admin')
  const [tab, setTab] = useState<TabId>('base')
  const tabs: { id: TabId; label: string }[] = [
    { id: 'base', label: t('setTabBase') },
    { id: 'security', label: t('setTabSecurity') },
    { id: 'ai', label: t('setTabAi') },
    { id: 'open', label: t('setTabOpen') },
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={`flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === tb.id
                ? 'bg-amber-500 text-white'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      {tab === 'base' && <BaseSection data={data} />}
      {tab === 'security' && <SecuritySection data={data} totpEnabled={totpEnabled} />}
      {tab === 'ai' && <AiSection data={data} />}
      {tab === 'open' && <OpenSection data={data} />}
    </div>
  )
}

// ---- 组 1：基础设置（站点信息 / 维护模式 / 入驻审核 / 计费预留）----

function BaseSection({ data }: { data: SettingsData }) {
  return (
    <div className="flex flex-col gap-4">
      <AppearanceBlock />
      <SiteBlock site={data.site} />
      <MaintenanceBlock maintenance={data.maintenance} />
      <OnboardingBlock onboarding={data.onboarding} />
      <BillingBlock billing={data.billing} />
    </div>
  )
}

// 外观：浅色 / 深色 / 跟随系统（三态）。即时写 cookie（spotnear.theme）并同步 <html>.dark，无需服务端保存。
function AppearanceBlock() {
  const t = useTranslations('admin')
  const { mode, setMode } = useThemeMode()
  const options: { id: ThemeMode; icon: string; key: string }[] = [
    { id: 'light', icon: '☀️', key: 'themeLight' },
    { id: 'system', icon: '💻', key: 'themeSystem' },
    { id: 'dark', icon: '🌙', key: 'themeDark' },
  ]
  return (
    <Card title={t('appearanceTitle')} hint={t('appearanceHint')}>
      <div className="flex gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setMode(o.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              mode === o.id
                ? 'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900/20 dark:text-amber-300'
                : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <span className="leading-none">{o.icon}</span>
            {t(o.key)}
          </button>
        ))}
      </div>
    </Card>
  )
}

function SiteBlock({ site }: { site: SettingsData['site'] }) {
  const t = useTranslations('admin')
  const { pending, msg, err, run } = useSave()
  const s = (site ?? {}) as Record<string, unknown>
  const [name, setName] = useState((s['name'] as string) ?? '')
  const [logoUrl, setLogoUrl] = useState((s['logoUrl'] as string) ?? '')
  const [timezone, setTimezone] = useState((s['timezone'] as string) ?? '')
  const [currency, setCurrency] = useState((s['currency'] as string) ?? '')
  const [defaultLocale, setDefaultLocale] = useState((s['defaultLocale'] as string) ?? '')
  function save() {
    run(async () => {
      await saveSiteSettings({ name, logoUrl, timezone, currency, defaultLocale })
    })
  }
  return (
    <Card title={t('setSite')} hint={t('setSiteHint')}>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500">{t('setSiteName')}</span>
        <Text value={name} onChange={setName} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500">{t('setSiteLogo')}</span>
        <Text value={logoUrl} onChange={setLogoUrl} />
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">{t('setSiteTimezone')}</span>
          <Text value={timezone} onChange={setTimezone} placeholder="Asia/Ho_Chi_Minh" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">{t('setSiteCurrency')}</span>
          <Text value={currency} onChange={setCurrency} placeholder="VND" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">{t('setSiteDefaultLocale')}</span>
          <Text value={defaultLocale} onChange={setDefaultLocale} placeholder="zh" />
        </label>
      </div>
      <SaveBar pending={pending} msg={msg} err={err} onSave={save} />
    </Card>
  )
}

function MaintenanceBlock({ maintenance }: { maintenance: SettingsData['maintenance'] }) {
  const t = useTranslations('admin')
  const { pending, msg, err, run } = useSave()
  const m = (maintenance ?? {}) as Record<string, unknown>
  const [mode, setMode] = useState(Boolean(m['mode']))
  const [message, setMessage] = useState((m['message'] as string) ?? '')
  function save() {
    run(async () => {
      await saveMaintenanceSettings({ mode, message })
    })
  }
  return (
    <Card title={t('setMaintenance')} hint={t('setMaintenanceHint')}>
      <Toggle
        checked={mode}
        onChange={setMode}
        label={t('setMaintenanceMode')}
        hint={mode ? t('setMaintenanceOnHint') : t('setMaintenanceOffHint')}
      />
      {mode && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">{t('setMaintenanceMessage')}</span>
          <Text value={message} onChange={setMessage} />
        </label>
      )}
      <SaveBar pending={pending} msg={msg} err={err} onSave={save} />
    </Card>
  )
}

function OnboardingBlock({ onboarding }: { onboarding: SettingsData['onboarding'] }) {
  const t = useTranslations('admin')
  const { pending, msg, err, run } = useSave()
  const o = (onboarding ?? {}) as Record<string, unknown>
  const [reviewRequired, setReviewRequired] = useState(Boolean(o['reviewRequired']))
  function save() {
    run(async () => {
      await saveOnboardingSettings({ reviewRequired })
    })
  }
  return (
    <Card title={t('setOnboarding')} hint={t('setOnboardingHint')}>
      <Toggle
        checked={reviewRequired}
        onChange={setReviewRequired}
        label={t('setOnboardingReview')}
        hint={reviewRequired ? t('setOnboardingOnHint') : t('setOnboardingOffHint')}
      />
      <SaveBar pending={pending} msg={msg} err={err} onSave={save} />
    </Card>
  )
}

function BillingBlock({ billing }: { billing: SettingsData['billing'] }) {
  const t = useTranslations('admin')
  const { pending, msg, err, run } = useSave()
  const b = (billing ?? {}) as Record<string, unknown>
  const [trialDays, setTrialDays] = useState(String(b['trialDays'] ?? ''))
  const [expiryPolicy, setExpiryPolicy] = useState((b['expiryPolicy'] as string) ?? 'lock')
  const [graceDays, setGraceDays] = useState(String(b['graceDays'] ?? ''))
  const policyOptions = [
    { value: 'lock', label: t('setExpiryPolicyLock') },
    { value: 'downgrade', label: t('setExpiryPolicyDowngrade') },
    { value: 'freeze', label: t('setExpiryPolicyFreeze') },
  ]
  function save() {
    run(async () => {
      await saveBillingSettings({
        trialDays: trialDays ? Number(trialDays) : undefined,
        expiryPolicy,
        graceDays: graceDays ? Number(graceDays) : undefined,
      })
    })
  }
  return (
    <Card title={t('setBilling')} hint={t('setBillingHint')}>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">{t('setBillingTrialDays')}</span>
          <Text value={trialDays} onChange={setTrialDays} type="number" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">{t('setBillingGraceDays')}</span>
          <Text value={graceDays} onChange={setGraceDays} type="number" />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500">{t('setBillingExpiryPolicy')}</span>
        <select
          value={expiryPolicy}
          onChange={(e) => setExpiryPolicy(e.target.value)}
          className={inputCls}
        >
          {policyOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <SaveBar pending={pending} msg={msg} err={err} onSave={save} />
    </Card>
  )
}

// ---- 组 2：安全与登录（2FA 个人 / 安全强化 / 社交登录 / 界面语言 + 层级预留）----

function SecuritySection({
  data,
  totpEnabled,
}: {
  data: SettingsData
  totpEnabled: boolean
}) {
  const t = useTranslations('admin')
  return (
    <div className="flex flex-col gap-4">
      <TwofaBlock totpEnabled={totpEnabled} />
      <SecurityBlock security={data.security} />
      <OauthBlock oauth={data.oauth} />
      <LocaleBlock />
      <Card title={t('setHierarchy')} hint={t('setHierarchyHint')}>
        <span className="self-start rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
          {t('comingSoon')}
        </span>
      </Card>
    </div>
  )
}

function TwofaBlock({ totpEnabled }: { totpEnabled: boolean }) {
  const t = useTranslations('admin')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [closeOtp, setCloseOtp] = useState('')
  const [bind, setBind] = useState<{ secret: string; uri: string } | null>(null)
  const [bindOtp, setBindOtp] = useState('')

  function onDisable() {
    setErr(null)
    setMsg(null)
    startTransition(async () => {
      try {
        await disableAdminTotp(closeOtp)
        setCloseOtp('')
        setMsg(t('twofaDisabled'))
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('totpInvalid'))
      }
    })
  }

  async function onStartBind() {
    setErr(null)
    setMsg(null)
    try {
      const r = await startAdminTotpSetup()
      setBind(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('toastError'))
    }
  }

  function onConfirmBind() {
    setErr(null)
    setMsg(null)
    startTransition(async () => {
      try {
        await confirmAdminTotp(bindOtp)
        setBind(null)
        setBindOtp('')
        setMsg(t('totpEnabled'))
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('totpInvalid'))
      }
    })
  }

  return (
    <Card title={t('secAccount')} hint={`${t('secTwofa')} · ${t(totpEnabled ? 'twofaOn' : 'twofaOff')}`}>
      {!totpEnabled && !bind && (
        <>
          <p className="text-xs text-zinc-500">{t('twofaHint')}</p>
          <div>
            <button onClick={onStartBind} className={btnCls}>
              {t('enableTwofa')}
            </button>
          </div>
        </>
      )}

      {!totpEnabled && bind && (
        <>
          <div className="flex justify-center rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800">
            <QRCode value={bind.uri} size={180} />
          </div>
          <details className="rounded-xl border border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800">
            <summary className="cursor-pointer select-none">{t('secretLabel')}</summary>
            <p className="mt-2 break-all font-mono">{bind.secret}</p>
          </details>
          <input
            value={bindOtp}
            onChange={(e) => setBindOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder={t('otp')}
            inputMode="numeric"
            maxLength={6}
            className={inputCls}
          />
          <button
            onClick={onConfirmBind}
            disabled={pending || bindOtp.length !== 6}
            className={btnCls}
          >
            {t('setupSubmit')}
          </button>
        </>
      )}

      {totpEnabled && (
        <>
          <p className="text-xs text-zinc-500">{t('disableTwofaHint')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={closeOtp}
              onChange={(e) => setCloseOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('otp')}
              inputMode="numeric"
              maxLength={6}
              className={`${inputCls} w-32`}
            />
            <button
              onClick={onDisable}
              disabled={pending || closeOtp.length !== 6}
              className={dangerBtnCls}
            >
              {t('disableTwofa')}
            </button>
          </div>
        </>
      )}

      {msg && <p className="text-sm text-green-600">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </Card>
  )
}

function SecurityBlock({ security }: { security: SettingsData['security'] }) {
  const t = useTranslations('admin')
  const { pending, msg, err, run } = useSave()
  const s = (security ?? {}) as Record<string, unknown>
  const [totpForce, setTotpForce] = useState(Boolean(s['totpForce']))
  const [rateLimitMax, setRateLimitMax] = useState(String(s['rateLimitMax'] ?? ''))
  const [rateLimitWindowMin, setRateLimitWindowMin] = useState(String(s['rateLimitWindowMin'] ?? ''))
  const [lockThreshold, setLockThreshold] = useState(String(s['accountLockThreshold'] ?? ''))
  const [lockMinutes, setLockMinutes] = useState(String(s['accountLockMinutes'] ?? ''))
  function save() {
    run(async () => {
      await saveSecuritySettings({
        totpForce,
        rateLimitMax: rateLimitMax ? Number(rateLimitMax) : undefined,
        rateLimitWindowMin: rateLimitWindowMin ? Number(rateLimitWindowMin) : undefined,
        accountLockThreshold: lockThreshold ? Number(lockThreshold) : undefined,
        accountLockMinutes: lockMinutes ? Number(lockMinutes) : undefined,
      })
    })
  }
  return (
    <Card title={t('setSecurity')} hint={t('setSecurityHint')}>
      <Toggle
        checked={totpForce}
        onChange={setTotpForce}
        label={t('setTotpForce')}
        hint={t('setTotpForceHint')}
      />
      <div className="grid grid-cols-2 gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">{t('setRateLimitMax')}</span>
          <Text value={rateLimitMax} onChange={setRateLimitMax} type="number" placeholder="3" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">{t('setRateLimitWindow')}</span>
          <Text value={rateLimitWindowMin} onChange={setRateLimitWindowMin} type="number" placeholder="5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">{t('setLockThreshold')}</span>
          <Text value={lockThreshold} onChange={setLockThreshold} type="number" placeholder="5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">{t('setLockMinutes')}</span>
          <Text value={lockMinutes} onChange={setLockMinutes} type="number" placeholder="15" />
        </label>
      </div>
      <SaveBar pending={pending} msg={msg} err={err} onSave={save} />
    </Card>
  )
}

function OauthBlock({ oauth }: { oauth: SettingsData['oauth'] }) {
  const t = useTranslations('admin')
  // P2-T（方向 A）：OAuth 凭据由环境变量配置，是本区块唯一真源。此处只读展示「实际生效」状态，不可编辑。
  const providers: {
    id: 'google' | 'facebook' | 'zalo'
    cfg: NonNullable<SettingsData['oauth']>['google']
  }[] = []
  if (oauth) {
    providers.push(
      { id: 'google', cfg: oauth.google },
      { id: 'facebook', cfg: oauth.facebook },
      { id: 'zalo', cfg: oauth.zalo },
    )
  }
  const providerLabel: Record<string, string> = {
    google: t('setOauthGoogle'),
    facebook: t('setOauthFacebook'),
    zalo: t('setOauthZalo'),
  }

  return (
    <Card title={t('setOauth')} hint={t('setOauthHint')}>
      {!oauth && <p className="text-xs text-zinc-500">{t('setOauthEmpty')}</p>}
      {providers.map((p) => {
        const configured = p.cfg.enabled ?? false
        return (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <span className="text-sm font-medium">
              {providerLabel[p.id]}
              {p.id === 'zalo' && (
                <span className="ml-1.5 text-xs font-normal text-zinc-400">
                  {t('setOauthZaloHint')}
                </span>
              )}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                configured
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              {configured ? t('setOauthSecretConfigured') : t('setOauthSecretNotConfigured')}
            </span>
          </div>
        )
      })}
    </Card>
  )
}

function LocaleBlock() {
  const t = useTranslations('admin')
  const router = useRouter()
  // admin 树 locale 在第 2 段（/admin/{locale}），从 useParams 取
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'
  function switchTo(loc: string) {
    const seg = window.location.pathname.split('/')
    seg[2] = loc
    router.replace(seg.join('/') + window.location.search)
  }
  return (
    <Card title={t('secLocale')} hint={t('secLocaleHint')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {routing.locales.map((loc) => (
          <button
            key={loc}
            type="button"
            onClick={() => switchTo(loc)}
            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
              loc === locale
                ? 'border-amber-300 bg-amber-50 font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <span>{LOCALE_NAMES[loc] ?? loc}</span>
            {loc === locale && <span className="text-amber-500">✓</span>}
          </button>
        ))}
      </div>
    </Card>
  )
}

// ---- 组 3：AI 与通知（AI 配置 / 通知预留）----

function AiSection({ data }: { data: SettingsData }) {
  return (
    <div className="flex flex-col gap-4">
      <AiBlock ai={data.ai} />
      <NotificationBlock notification={data.notification} />
    </div>
  )
}

function AiBlock({ ai }: { ai: SettingsData['ai'] }) {
  const t = useTranslations('admin')
  const { pending, msg, err, run } = useSave()
  const [minimaxKey, setMinimaxKey] = useState('')
  const [minimaxModel, setMinimaxModel] = useState(ai.minimaxModel ?? '')
  const [deepseekKey, setDeepseekKey] = useState('')
  const [deepseekModel, setDeepseekModel] = useState(ai.deepseekModel ?? '')
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiModel, setGeminiModel] = useState(ai.geminiModel ?? '')
  function save() {
    run(async () => {
      await saveAiConfig({
        minimaxKey: minimaxKey || undefined,
        minimaxModel,
        deepseekKey: deepseekKey || undefined,
        deepseekModel,
        geminiKey: geminiKey || undefined,
        geminiModel,
      })
      setMinimaxKey('')
      setDeepseekKey('')
      setGeminiKey('')
    })
  }
  const providers = [
    {
      label: t('setAiMinimax'),
      key: minimaxKey,
      setKey: setMinimaxKey,
      model: minimaxModel,
      setModel: setMinimaxModel,
      configured: ai.minimaxKeyConfigured,
    },
    {
      label: t('setAiDeepseek'),
      key: deepseekKey,
      setKey: setDeepseekKey,
      model: deepseekModel,
      setModel: setDeepseekModel,
      configured: ai.deepseekKeyConfigured,
    },
    {
      label: t('setAiGemini'),
      key: geminiKey,
      setKey: setGeminiKey,
      model: geminiModel,
      setModel: setGeminiModel,
      configured: ai.geminiKeyConfigured,
    },
  ]
  return (
    <Card title={t('setAi')} hint={t('setAiHint')}>
      {providers.map((p) => (
        <div
          key={p.label}
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{p.label}</span>
            {p.configured ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
                {t('setKeyConfigured')}
              </span>
            ) : (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                {t('setKeyNotConfigured')}
              </span>
            )}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">{t('setAiKey')}</span>
            <Text value={p.key} onChange={p.setKey} type="password" placeholder="sk-•••" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">{t('setAiModel')}</span>
            <Text value={p.model} onChange={p.setModel} />
          </label>
        </div>
      ))}
      <SaveBar pending={pending} msg={msg} err={err} onSave={save} />
    </Card>
  )
}

function NotificationBlock({ notification }: { notification: SettingsData['notification'] }) {
  const t = useTranslations('admin')
  const { pending, msg, err, run } = useSave()
  const smtp: NonNullable<SettingsData['notification']>['smtp'] =
    notification?.smtp ?? ({} as NonNullable<SettingsData['notification']>['smtp'])
  const sms: NonNullable<SettingsData['notification']>['sms'] =
    notification?.sms ?? ({} as NonNullable<SettingsData['notification']>['sms'])
  const [smtpEnabled, setSmtpEnabled] = useState(smtp.enabled ?? false)
  const [smtpHost, setSmtpHost] = useState(smtp.host ?? '')
  const [smtpPort, setSmtpPort] = useState(String(smtp.port ?? ''))
  const [smtpUser, setSmtpUser] = useState(smtp.user ?? '')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpFrom, setSmtpFrom] = useState(smtp.from ?? '')
  const [smsEnabled, setSmsEnabled] = useState(sms.enabled ?? false)
  const [smsProvider, setSmsProvider] = useState(sms.provider ?? '')
  const [smsApiKey, setSmsApiKey] = useState('')
  const [smsFrom, setSmsFrom] = useState(sms.from ?? '')
  function save() {
    run(async () => {
      await saveNotificationSettings({
        smtpEnabled,
        smtpHost,
        smtpPort: smtpPort ? Number(smtpPort) : undefined,
        smtpUser,
        smtpPassword: smtpPassword || undefined,
        smtpFrom,
        smsEnabled,
        smsProvider,
        smsApiKey: smsApiKey || undefined,
        smsFrom,
      })
      setSmtpPassword('')
      setSmsApiKey('')
    })
  }
  return (
    <Card title={t('setNotification')} hint={t('setNotificationHint')}>
      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Toggle checked={smtpEnabled} onChange={setSmtpEnabled} label={t('setSmtp')} />
        {smtpEnabled && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">{t('setSmtpHost')}</span>
              <Text value={smtpHost} onChange={setSmtpHost} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">{t('setSmtpPort')}</span>
              <Text value={smtpPort} onChange={setSmtpPort} type="number" placeholder="587" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">{t('setSmtpUser')}</span>
              <Text value={smtpUser} onChange={setSmtpUser} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">{t('setSmtpPassword')}</span>
              <Text value={smtpPassword} onChange={setSmtpPassword} type="password" />
              <span className={hintCls}>
                {smtp.passwordConfigured
                  ? t('setSmtpSecretConfigured')
                  : t('setSmtpSecretNotConfigured')}
              </span>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-zinc-500">{t('setSmtpFrom')}</span>
              <Text value={smtpFrom} onChange={setSmtpFrom} />
            </label>
          </div>
        )}
      </div>
      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <Toggle checked={smsEnabled} onChange={setSmsEnabled} label={t('setSms')} />
        {smsEnabled && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">{t('setSmsProvider')}</span>
              <Text value={smsProvider} onChange={setSmsProvider} placeholder="twilio" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">{t('setSmsApiKey')}</span>
              <Text value={smsApiKey} onChange={setSmsApiKey} type="password" />
              <span className={hintCls}>
                {sms.apiKeyConfigured
                  ? t('setSmsSecretConfigured')
                  : t('setSmsSecretNotConfigured')}
              </span>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-zinc-500">{t('setSmsFrom')}</span>
              <Text value={smsFrom} onChange={setSmsFrom} />
            </label>
          </div>
        )}
      </div>
      <SaveBar pending={pending} msg={msg} err={err} onSave={save} />
    </Card>
  )
}

// ---- 组 4：开放与审计（套餐定义 / API key / 审计日志）----

function OpenSection({ data }: { data: SettingsData }) {
  return (
    <div className="flex flex-col gap-4">
      <TierBlock tiers={data.tiers} />
      <AnnouncementBlock announcements={data.announcements} />
      <ApiKeyBlock apiKeys={data.apiKeys} />
      <AuditBlock />
    </div>
  )
}

function TierBlock({ tiers }: { tiers: SettingsData['tiers'] }) {
  const t = useTranslations('admin')
  const { pending, msg, err, run } = useSave()
  const empty = { key: '', name: '', price: '', months: '', shopLimit: '', productLimit: '', aiQuota: '' }
  const [form, setForm] = useState(empty)
  const [editKey, setEditKey] = useState<string | null>(null)

  function startEdit(key: string) {
    const tier = tiers.find((x) => x.key === key)
    if (!tier) return
    setEditKey(key)
    setForm({
      key,
      name: tier.name,
      price: tier.price,
      months: String(tier.months),
      shopLimit: tier.shopLimit != null ? String(tier.shopLimit) : '',
      productLimit: tier.productLimit != null ? String(tier.productLimit) : '',
      aiQuota: tier.aiQuota != null ? String(tier.aiQuota) : '',
    })
  }

  function save() {
    run(async () => {
      await saveTier({
        key: editKey ?? form.key,
        name: form.name,
        price: Number(form.price),
        months: Number(form.months),
        shopLimit: form.shopLimit ? Number(form.shopLimit) : null,
        productLimit: form.productLimit ? Number(form.productLimit) : null,
        aiQuota: form.aiQuota ? Number(form.aiQuota) : null,
      })
      setForm(empty)
      setEditKey(null)
    })
  }

  function onDelete(key: string) {
    if (!window.confirm(t('setTierDeleteConfirm'))) return
    run(async () => {
      await deleteTier(key)
    })
  }

  return (
    <Card title={t('setTiers')} hint={t('setTiersHint')}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-700">
              <th className="py-1 pr-2">{t('setTierKey')}</th>
              <th className="py-1 pr-2">{t('setTierName')}</th>
              <th className="py-1 pr-2">{t('setTierPrice')}</th>
              <th className="py-1 pr-2">{t('setTierMonths')}</th>
              <th className="py-1 pr-2">{t('setTierLimits')}</th>
              <th className="py-1">{t('setTierActions')}</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.key} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-1.5 pr-2 font-mono text-xs">{tier.key}</td>
                <td className="py-1.5 pr-2">{tier.name}</td>
                <td className="py-1.5 pr-2">{tier.price}</td>
                <td className="py-1.5 pr-2">{tier.months}</td>
                <td className="py-1.5 pr-2 text-xs text-zinc-500">
                  {tier.shopLimit != null ? `${tier.shopLimit}店/` : '∞店/'}
                  {tier.productLimit != null ? `${tier.productLimit}品` : '∞品'}
                </td>
                <td className="py-1.5">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(tier.key)}
                      className="text-xs text-amber-600 hover:underline"
                    >
                      {t('setTierEdit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(tier.key)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      {t('setTierDelete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="mb-2 text-sm font-medium">
          {editKey ? `${t('setTierEdit')} ${editKey}` : t('setTierAdd')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">{t('setTierKey')}</span>
            <input
              value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
              disabled={!!editKey}
              className={`${inputCls} uppercase`}
              placeholder="BASIC"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">{t('setTierName')}</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">{t('setTierPrice')}</span>
            <input
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              type="number"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">{t('setTierMonths')}</span>
            <input
              value={form.months}
              onChange={(e) => setForm((f) => ({ ...f, months: e.target.value }))}
              type="number"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">{t('setTierShopLimit')}</span>
            <input
              value={form.shopLimit}
              onChange={(e) => setForm((f) => ({ ...f, shopLimit: e.target.value }))}
              type="number"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">{t('setTierProductLimit')}</span>
            <input
              value={form.productLimit}
              onChange={(e) => setForm((f) => ({ ...f, productLimit: e.target.value }))}
              type="number"
              className={inputCls}
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">{t('setTierAiQuota')}</span>
            <input
              value={form.aiQuota}
              onChange={(e) => setForm((f) => ({ ...f, aiQuota: e.target.value }))}
              type="number"
              className={inputCls}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={save} disabled={pending} className={btnCls}>
            {t('setSave')}
          </button>
          {editKey && (
            <button
              onClick={() => {
                setForm(empty)
                setEditKey(null)
              }}
              className="text-sm text-zinc-500 hover:underline"
            >
              {t('setCancel')}
            </button>
          )}
          {msg && <span className="text-sm text-green-600">{msg}</span>}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>
    </Card>
  )
}

function ApiKeyBlock({ apiKeys }: { apiKeys: SettingsData['apiKeys'] }) {
  const t = useTranslations('admin')
  const { pending, msg, err, run } = useSave()
  const [name, setName] = useState('')
  const [plain, setPlain] = useState<string | null>(null)
  function create() {
    run(async () => {
      const r = await createApiKey(name)
      setPlain(r.plain)
      setName('')
    })
  }
  function onRevoke(id: string) {
    if (!window.confirm(t('setApiKeyRevokeConfirm'))) return
    run(async () => {
      await revokeApiKey(id)
    })
  }
  return (
    <Card title={t('setApiKeys')} hint={t('setApiKeysHint')}>
      {plain && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <p className="font-medium">{t('setApiKeyPlainHint')}</p>
          <code className="mt-1 block break-all font-mono">{plain}</code>
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('setApiKeyName')}
          className={`${inputCls} flex-1`}
        />
        <button onClick={create} disabled={pending || !name.trim()} className={btnCls}>
          {t('setApiKeyCreate')}
        </button>
      </div>
      {apiKeys.length === 0 && <p className="text-xs text-zinc-500">{t('setApiKeysEmpty')}</p>}
      <ul className="flex flex-col gap-2">
        {apiKeys.map((k) => (
          <li
            key={k.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800"
          >
            <div className="flex flex-col">
              <span className="text-sm">{k.name}</span>
              <span className="text-xs text-zinc-500">
                {k.revokedAt
                  ? t('setApiKeyRevoked')
                  : `${t('setApiKeyScope')} ${k.scope}`}
              </span>
            </div>
            {!k.revokedAt && (
              <button onClick={() => onRevoke(k.id)} className={dangerBtnCls}>
                {t('setApiKeyRevoke')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className="text-sm text-green-600">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </Card>
  )
}

// 公告管理（2026-08-30 补全）：后端 saveAnnouncement/deleteAnnouncement 早已完备，此块补齐前端 UI。
// 数据来自 getSettingsData().announcements（最多 50 条）。表单仅暴露标题/正文/启用（locale/时间窗口留空 = 全站公告）。
function AnnouncementBlock({ announcements }: { announcements: SettingsData['announcements'] }) {
  const t = useTranslations('admin')
  const { pending, msg, err, run } = useSave()
  const empty = { id: '', title: '', body: '', active: true }
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState<string | null>(null)

  function startEdit(a: SettingsData['announcements'][number]) {
    setEditId(a.id)
    setForm({ id: a.id, title: a.title, body: a.body, active: a.active })
  }

  function save() {
    run(async () => {
      await saveAnnouncement({
        id: editId ?? undefined,
        title: form.title,
        body: form.body,
        active: form.active,
      })
      setForm(empty)
      setEditId(null)
    })
  }

  function onDelete(id: string) {
    if (!window.confirm(t('setAnnouncementDeleteConfirm'))) return
    run(async () => {
      await deleteAnnouncement(id)
    })
  }

  return (
    <Card title={t('setAnnouncements')} hint={t('setAnnouncementsHint')}>
      <div className="flex flex-col gap-2">
        <Text
          value={form.title}
          onChange={(v) => setForm({ ...form, title: v })}
          placeholder={t('setAnnouncementTitle')}
        />
        <textarea
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          placeholder={t('setAnnouncementBody')}
          rows={3}
          className={`${inputCls} w-full`}
        />
        <Toggle
          checked={form.active}
          onChange={(v) => setForm({ ...form, active: v })}
          label={t('setAnnouncementActive')}
        />
        <SaveBar
          pending={pending}
          msg={msg}
          err={err}
          onSave={save}
          label={editId ? t('setAnnouncementUpdate') : t('setAnnouncementAdd')}
        />
      </div>
      {announcements.length === 0 && <p className="text-xs text-zinc-500">{t('setAnnouncementEmpty')}</p>}
      <ul className="flex flex-col gap-2">
        {announcements.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800"
          >
            <div className="flex flex-col">
              <span className="text-sm">{a.title}</span>
              <span className="text-xs text-zinc-500">
                {a.active ? t('setAnnouncementActiveYes') : t('setAnnouncementActiveNo')}
                {a.locale ? ` · ${a.locale}` : ''}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => startEdit(a)} className={btnCls}>
                {t('setAnnouncementEdit')}
              </button>
              <button onClick={() => onDelete(a.id)} className={dangerBtnCls}>
                {t('setAnnouncementDelete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

const AUDIT_ACTIONS = ['LOGIN', 'SHOP_MANAGE', 'BILL', 'CONFIG_CHANGE', 'TOTP', 'PLAN', 'ANNOUNCEMENT', 'APIKEY', 'AUTH', 'RESET_PWD']
const AUDIT_TARGETS = ['SHOP', 'USER', 'PLAN', 'SETTING', 'ANNOUNCEMENT', 'APIKEY']

function AuditBlock() {
  const t = useTranslations('admin')
  type LogRow = Awaited<ReturnType<typeof listAuditLogs>>['rows'][number]
  const [rows, setRows] = useState<LogRow[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [action, setAction] = useState('')
  const [target, setTarget] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    listAuditLogs(page, {
      action: action || undefined,
      targetType: target || undefined,
    }).then((r) => {
      if (!alive) return
      setRows(r.rows)
      setTotal(r.total)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [page, action, target])

  const pageSize = 30
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Card title={t('setAudit')} hint={t('setAuditHint')}>
      <div className="flex flex-wrap gap-2">
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value)
            setPage(1)
          }}
          className={inputCls}
        >
          <option value="">{t('setAuditAllActions')}</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value)
            setPage(1)
          }}
          className={inputCls}
        >
          <option value="">{t('setAuditAllTargets')}</option>
          {AUDIT_TARGETS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-xs text-zinc-500">{t('setAuditLoading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-zinc-500">{t('setAuditEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-zinc-200 p-2 text-xs dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-zinc-500">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {r.action}
                </span>
              </div>
              <p className="mt-1">
                <span className="font-medium">{r.actorName ?? r.actorId}</span>
                {' · '}
                {r.targetType}
                {r.targetId ? ` · ${r.targetId}` : ''}
              </p>
              {r.detail && (
                <p className="mt-0.5 break-all text-zinc-500">
                  {JSON.stringify(r.detail).slice(0, 120)}
                </p>
              )}
              {r.ip && <p className="mt-0.5 text-zinc-400">{r.ip}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="text-amber-600 hover:underline disabled:opacity-40"
        >
          {t('prev')}
        </button>
        <span>
          {t('pageInfo', { page, total: pageCount })}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          disabled={page >= pageCount}
          className="text-amber-600 hover:underline disabled:opacity-40"
        >
          {t('next')}
        </button>
      </div>
    </Card>
  )
}
