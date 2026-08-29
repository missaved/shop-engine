'use client'

import { useState } from 'react'
import { signIn, getSession, signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { LocaleSwitcher } from '@/components/locale-switcher'

// 老板登录页：手机号 + 密码（Auth.js Credentials）
// 第 20 批 A4（8.1 决策）：/login 为 boss 专属入口，admin 在此登录后登出并引导 /admin/login
export default function LoginPage() {
  const t = useTranslations('login')
  const router = useRouter()
  const [error, setError] = useState<'error' | 'rateLimited' | 'notAdmin' | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)

    try {
      const form = new FormData(e.currentTarget)
      const res = await signIn('credentials', {
        phone: form.get('phone'),
        password: form.get('password'),
        redirect: false,
      })

      if (res?.error) {
        if (res.code === 'RATE_LIMITED') setError('rateLimited')
        // admin 账号（已绑定 TOTP）走 boss 入口：authorize 抛 NEED_TOTP，提示改走 /admin/login
        else if (res.code === 'NEED_TOTP') setError('notAdmin')
        else setError('error')
        return
      }
      const session = await getSession()
      if (session?.user?.role === 'ADMIN') {
        // admin 不该走 boss 登录：登出并提示走 /admin/login
        await signOut({ redirect: false })
        setError('notAdmin')
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      console.error('登录失败:', err)
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
        <h1 className="mb-5 text-xl font-semibold">{t('title')}</h1>

        <label className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
          {t('phone')}
        </label>
        <input
          name="phone"
          type="tel"
          required
          autoComplete="tel"
          className="mb-4 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />

        <label className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
          {t('password')}
        </label>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mb-4 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">
            {error === 'notAdmin' ? t('adminGoAdminLogin') : t(error === 'rateLimited' ? 'rateLimited' : 'error')}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? '…' : t('submit')}
        </button>
      </form>
    </main>
  )
}
