'use client'

import { useState } from 'react'
import { signIn, getSession, signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { useRouter, useParams } from 'next/navigation'
import { LocaleSwitcher } from '@/components/locale-switcher'

// admin 专属两步登录（第 20 批 A4）：手机号+密码 → TOTP 验证码
// 与 /login（boss 专属）彻底分离；未绑定 TOTP 的 admin 登录后由 /admin 引导去绑定页
export default function AdminLoginPage() {
  const t = useTranslations('admin')
  const tl = useTranslations('login')
  const router = useRouter()
  // admin 树 locale 在第 2 段（/admin/{locale}），从 useParams 直接取
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'
  const [step, setStep] = useState<'pwd' | 'otp'>('pwd')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<'error' | 'rateLimited' | 'accountLocked' | 'totpInvalid' | 'notAdmin' | null>(null)
  const [pending, setPending] = useState(false)

  function errText() {
    switch (error) {
      case 'rateLimited':
        return tl('rateLimited')
      case 'accountLocked':
        return tl('accountLocked')
      case 'totpInvalid':
        return t('totpInvalid')
      case 'notAdmin':
        return tl('adminGoAdminLogin')
      default:
        return tl('error')
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)

    try {
      const form = new FormData(e.currentTarget)
      const res = await signIn('credentials', {
        phone,
        password,
        otp: form.get('otp'),
        redirect: false,
      })

      if (res?.error) {
        if (res.code === 'NEED_TOTP') {
          setStep('otp') // 密码通过，进入验证码第二步
          return
        }
        if (res.code === 'RATE_LIMITED') setError('rateLimited')
        // 登录失败锁定（2026-08-29）：账号被锁定，后台 unlockUser 解锁
        else if (res.code === 'ACCOUNT_LOCKED') setError('accountLocked')
        else if (res.code === 'TOTP_INVALID') setError('totpInvalid')
        else setError('error')
        return
      }

      const session = await getSession()
      if (session?.user?.role !== 'ADMIN') {
        // 非 admin（如店主）误登 admin 入口：登出并提示
        await signOut({ redirect: false })
        setError('notAdmin')
        return
      }
      router.push(`/admin/${locale}`)
      router.refresh()
    } catch (err) {
      console.error('admin 登录失败:', err)
      setError('error')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
      <LocaleSwitcher />
      <form
        method="post"
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h1 className="mb-1 text-xl font-semibold">{t('adminOnly')}</h1>
        <p className="mb-5 text-xs text-zinc-500">
          {step === 'otp' ? t('needOtp') : tl('title')}
        </p>

        {step === 'pwd' ? (
          <>
            <label className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
              {t('loginName')}
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              name="phone"
              type="tel"
              required
              autoComplete="tel"
              className="mb-4 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />

            <label className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
              {tl('password')}
            </label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mb-4 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </>
        ) : (
          <>
            <label className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
              {t('otp')}
            </label>
            <input
              name="otp"
              type="text"
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              required
              autoComplete="one-time-code"
              autoFocus
              className="mb-4 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </>
        )}

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">{errText()}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? '…' : step === 'otp' ? t('setupSubmit') : tl('submit')}
        </button>
      </form>
    </main>
  )
}
