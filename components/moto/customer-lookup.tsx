'use client'
// M6a 客户入口（店码落地页）：注册/登录（customer provider）+ 匿名查询车牌进度（6.3b）
// 登录不强制：匿名查询兜底低门槛客户；登录服务想留档/收提醒/查历史的客户
import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { signIn } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import {
  registerCustomer,
  getVehicleAnonStatus,
  type MyVehicle,
} from '@/lib/customer-actions'
import { formatPrice } from '@/lib/format'
import { shopSubUrl, localizedUrl } from '@/lib/urls'
import type { Vertical } from '@/lib/vertical'
import type { CitySlug } from '@/lib/city'
import type { Locale } from '@/i18n/routing'
import { useToast, ToastView } from '../dashboard/use-toast'

const inputCls =
  'w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900'

export function CustomerLookup({
  vertical,
  slug,
  city,
  shopName,
  currency,
  isLoggedIn,
  oauth,
}: {
  vertical: Vertical
  slug: string
  city: CitySlug
  shopName: string
  currency: string
  isLoggedIn: boolean
  // OAuth 主通道 provider 配置：id + 是否已配 key（未配 → 组件渲染 disabled 占位）
  oauth: { id: 'google' | 'facebook'; configured: boolean }[]
}) {
  const t = useTranslations('customer')
  const tm = useTranslations('moto')
  const locale = useLocale()
  const router = useRouter()
  const { msg, show } = useToast()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // 匿名查询
  const [aPlate, setAPlate] = useState('')
  const [aTail, setATail] = useState('')
  const [anon, setAnon] = useState<MyVehicle | null>(null)
  const [anonMsg, setAnonMsg] = useState<string | null>(null)

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setPending(true)
    try {
      if (mode === 'register') {
        const r = await registerCustomer({ phone, password, name })
        if (!r.ok) {
          setErr(r.error)
          return
        }
        show(t('registeredOk'))
        // 注册成功切登录态，提示输入密码登录
        setMode('login')
        setPassword('')
      } else {
        const res = await signIn('customer-credentials', {
          phone,
          password,
          redirect: false,
        })
        if (res?.error) {
          setErr('loginFailed')
          return
        }
        router.push(shopSubUrl({ vertical, slug, city }, 'my'))
        router.refresh()
      }
    } catch (e) {
      console.error('客户登录/注册失败:', e)
      setErr('error')
    } finally {
      setPending(false)
    }
  }

  async function doAnon(e: React.FormEvent) {
    e.preventDefault()
    setAnonMsg(null)
    setAnon(null)
    try {
      const r = await getVehicleAnonStatus(slug, aPlate, aTail)
      if (!r.ok) {
        setAnonMsg(r.error)
        return
      }
      setAnon(r.data.vehicle)
    } catch (e) {
      console.error('匿名查询失败:', e)
      setAnonMsg('error')
    }
  }

  const progressLabel = (p: string | null) =>
    p ? tm(p as never) ?? p : ''

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-400">{shopName}</p>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </div>
      </header>

      {isLoggedIn ? (
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm">{t('loggedInHint')}</p>
          <button
            onClick={() => router.push(shopSubUrl({ vertical, slug, city }, 'my'))}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white"
          >
            {t('myVehicles')}
          </button>
        </div>
      ) : (
        <>
          {/* OAuth 主通道（定案：主实例 /api/auth，与老板同 basePath）：configured → signIn()（POST+CSRF）。
              next-auth v5 禁 GET 启动 OAuth（GET 走 renderPage，带 providerId 必抛 Unsupported action），
              GET 锚点已作废；未配置 → disabled 占位（用户拍板显示占位）。callbackUrl 传未编码本地路径（signIn 自编码）。 */}
          <div className="flex flex-col gap-2">
            {oauth.map((p) => {
              // signIn 会对 callbackUrl 自行编码/解析，这里传未编码的本地路径（双重 encode 会导致回跳 URL 错）
              const cb = localizedUrl(
                shopSubUrl({ vertical, slug, city }, 'my'),
                locale as Locale,
              )
              const label =
                p.id === 'google' ? t('continueGoogle') : t('continueFacebook')
              const btn =
                'flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors'
              return p.configured ? (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => signIn(p.id, { callbackUrl: cb })}
                  className={`${btn} border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800`}
                >
                  {label}
                </button>
              ) : (
                <button
                  key={p.id}
                  type="button"
                  disabled
                  className={`${btn} cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600`}
                >
                  {label} · {t('socialLoginUnavailable')}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            {t('socialLoginHint')}
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          {/* 注册/登录 */}
          <form
            onSubmit={submitAuth}
            className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex gap-2 text-sm font-medium">
              <button
                type="button"
                onClick={() => {
                  setMode('login')
                  setErr(null)
                }}
                className={`rounded-md px-3 py-1 ${mode === 'login' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500'}`}
              >
                {t('login')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register')
                  setErr(null)
                }}
                className={`rounded-md px-3 py-1 ${mode === 'register' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500'}`}
              >
                {t('register')}
              </button>
            </div>
            {mode === 'register' && (
              <input
                className={inputCls}
                placeholder={t('name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
            <input
              className={inputCls}
              type="tel"
              placeholder={t('phone')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <input
              className={inputCls}
              type="password"
              placeholder={t('password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {err && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {t(err as never) ?? err}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {mode === 'login' ? t('loginBtn') : t('registerBtn')}
            </button>
          </form>

          {/* 匿名查询 */}
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium">{t('anonTitle')}</p>
            <p className="text-xs text-zinc-500">{t('anonHint')}</p>
            <form onSubmit={doAnon} className="flex flex-col gap-2">
              <input
                className={inputCls}
                placeholder={t('anonPlate')}
                value={aPlate}
                onChange={(e) => setAPlate(e.target.value)}
                required
              />
              <input
                className={inputCls}
                type="tel"
                placeholder={t('anonPhoneTail')}
                value={aTail}
                onChange={(e) => setATail(e.target.value)}
                required
              />
              {anonMsg && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {t(anonMsg as never) ?? anonMsg}
                </p>
              )}
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
              >
                {t('anonSubmit')}
              </button>
            </form>
            {anon && (
              <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{anon.plate}</span>
                  <span className="text-xs text-zinc-500">
                    {anon.brand ?? ''} {anon.model ?? ''}
                  </span>
                </div>
                {anon.currentOrder ? (
                  <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
                    <span className="text-xs">
                      {tm('progress')}:{' '}
                      <span className="font-medium">
                        {progressLabel(anon.currentOrder.progress)}
                      </span>
                    </span>
                    <span className="text-xs">
                      {formatPrice(Number(anon.currentOrder.total), currency)}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">{t('noActiveOrder')}</p>
                )}
              </div>
            )}
          </div>
        </>
      )}
      <ToastView msg={msg} />
    </main>
  )
}
