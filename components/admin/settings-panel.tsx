'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, useParams } from 'next/navigation'
import QRCode from 'react-qr-code'
import {
  disableAdminTotp,
  startAdminTotpSetup,
  confirmAdminTotp,
} from '@/lib/admin-actions'
import { routing } from '@/i18n/routing'

// 各语种「自称」（列表里展示用，与 locale-switcher 一致）
const LOCALE_NAMES: Record<string, string> = {
  zh: '简体中文',
  'zh-Hant': '繁體中文',
  en: 'English',
  vi: 'Tiếng Việt',
  ms: 'Bahasa Melayu',
  th: 'ไทย',
}

const cardCls =
  'flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900'
const inputCls =
  'rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800'

// 用户设置面板：账号安全（2FA 开关）+ 界面语言 + 层级管理预留。
// 语言切换不走弹出层：内联列表，天然规避「弹出菜单位置不正确」。
export function SettingsPanel({ totpEnabled }: { totpEnabled: boolean }) {
  const t = useTranslations('admin')
  const router = useRouter()
  // admin 树 locale 在第 2 段（/admin/{locale}），从 useParams 取
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // 关闭 2FA：须输入当前验证码
  const [closeOtp, setCloseOtp] = useState('')
  // 开启 2FA：内联绑定（生成密钥 → 扫码/手输 → 确认）
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

  // 界面语言切换：/admin/{locale}/... → 替换 locale 段，原地刷新设置页
  function switchTo(loc: string) {
    const seg = window.location.pathname.split('/')
    seg[2] = loc
    router.replace(seg.join('/') + window.location.search)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 账号与安全：2FA 开关 */}
      <section className={cardCls}>
        <div>
          <h2 className="text-sm font-medium">{t('secAccount')}</h2>
          <p className="mt-1 text-xs text-zinc-500">{t('secTwofa')} · {t(totpEnabled ? 'twofaOn' : 'twofaOff')}</p>
        </div>

        {!totpEnabled && !bind && (
          <>
            <p className="text-xs text-zinc-500">{t('twofaHint')}</p>
            <div>
              <button
                onClick={onStartBind}
                className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98]"
              >
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
              className="w-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
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
                className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                {t('disableTwofa')}
              </button>
            </div>
          </>
        )}

        {msg && <p className="text-sm text-green-600">{msg}</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
      </section>

      {/* 界面语言 */}
      <section className={cardCls}>
        <div>
          <h2 className="text-sm font-medium">{t('secLocale')}</h2>
          <p className="mt-1 text-xs text-zinc-500">{t('secLocaleHint')}</p>
        </div>
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
      </section>

      {/* 层级管理预留 */}
      <section className={cardCls}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t('secHierarchy')}</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
            {t('comingSoon')}
          </span>
        </div>
        <p className="text-xs text-zinc-500">{t('hierarchyHint')}</p>
      </section>
    </div>
  )
}
