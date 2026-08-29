'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, useParams } from 'next/navigation'
import QRCode from 'react-qr-code'
import { startAdminTotpSetup, confirmAdminTotp } from '@/lib/admin-actions'

// admin TOTP 绑定引导（第 20 批 A4）：挂载即生成 secret + otpauth URI，输验证码完成绑定
export function AdminTotpSetup() {
  const t = useTranslations('admin')
  const router = useRouter()
  // admin 树 locale 在第 2 段（/admin/{locale}），绑定成功后回 /admin/{locale}
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'
  const [secret, setSecret] = useState<string | null>(null)
  const [uri, setUri] = useState('')
  const [otp, setOtp] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(true)

  // 挂载即生成（一次性绑定流程，刷新重新生成可接受）
  useEffect(() => {
    let alive = true
    startAdminTotpSetup()
      .then((r) => {
        if (!alive) return
        setSecret(r.secret)
        setUri(r.uri)
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : t('toastError')))
      .finally(() => alive && setPending(false))
    return () => {
      alive = false
    }
  }, [t])

  async function copySecret() {
    if (!secret) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(secret)
      } else {
        // 非 secure context（局域网 http）clipboard 不可用 → 隐藏 textarea 选中 execCommand 兜底
        const el = document.createElement('textarea')
        el.value = secret
        el.style.position = 'fixed'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setMsg(t('copySecret'))
    } catch {
      setErr('Clipboard unavailable')
    }
  }

  async function confirm() {
    setErr(null)
    setMsg(null)
    setPending(true)
    try {
      await confirmAdminTotp(otp)
      setMsg(t('totpEnabled'))
      router.push(`/admin/${locale}`)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('totpInvalid'))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-semibold">{t('setupTitle')}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('setupHint')}</p>

      {pending ? (
        <p className="text-sm text-zinc-500">…</p>
      ) : secret ? (
        <>
          {/* 桌面端 TOTP 绑定以二维码扫描为主（第 20 批 A4 整改：管理员是电脑端） */}
          {uri && (
            <div className="flex justify-center rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800">
              <QRCode value={uri} size={220} />
            </div>
          )}

          {/* 手动输入兜底：二维码扫不了时用（收进折叠区，不作为主路径） */}
          <details className="rounded-xl border border-zinc-200 p-4 text-xs text-zinc-500 dark:border-zinc-800">
            <summary className="cursor-pointer select-none">{t('secretLabel')}</summary>
            <p className="mt-2 break-all font-mono">{secret}</p>
            <button
              onClick={copySecret}
              className="mt-2 rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {t('copySecret')}
            </button>
            <p className="mt-3 break-all font-mono text-[11px] text-zinc-500">{uri}</p>
          </details>

          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder={t('otp')}
            inputMode="numeric"
            maxLength={6}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
          <button
            onClick={confirm}
            disabled={pending || otp.length !== 6}
            className="w-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
          >
            {t('setupSubmit')}
          </button>
        </>
      ) : null}

      {msg && <p className="text-sm text-green-600">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </main>
  )
}
