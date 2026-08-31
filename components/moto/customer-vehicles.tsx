'use client'
// M6a 我的车辆（登录客户）：车辆卡片 → 当前在修单（motoProgress 实时进度）+ 历史维保 + 下次保养
// 认领表单：本店输车牌，手机号匹配自动绑定；查绑定内容必须先认领（claimVehicle 强制）
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getMyVehicles, claimVehicle, type MyVehicle } from '@/lib/customer-actions'
import { formatPrice } from '@/lib/format'
import { useToast, ToastView } from '../dashboard/use-toast'

const inputCls =
  'w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900'

export function CustomerVehicles({
  slug,
  currency,
  shopName,
}: {
  slug: string
  currency: string
  shopName: string
}) {
  const t = useTranslations('customer')
  const tm = useTranslations('moto')
  const { msg, show } = useToast()
  const [vehicles, setVehicles] = useState<MyVehicle[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [plate, setPlate] = useState('')
  const [claimErr, setClaimErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await getMyVehicles(slug)
      if (!r.ok) {
        setErr(r.error)
        return
      }
      setVehicles(r.data)
    } catch (e) {
      console.error('我的车辆加载失败:', e)
      setErr('error')
    }
  }, [slug])

  useEffect(() => {
    load()
  }, [load])

  async function doClaim(e: React.FormEvent) {
    e.preventDefault()
    setClaimErr(null)
    setPending(true)
    try {
      const r = await claimVehicle(slug, plate)
      if (!r.ok) {
        setClaimErr(r.error)
        return
      }
      setPlate('')
      show(t('claimed'))
      await load()
    } catch (e) {
      console.error('认领失败:', e)
      setClaimErr('error')
    } finally {
      setPending(false)
    }
  }

  const progressLabel = (p: string | null) =>
    p ? tm(p as never) ?? p : ''

  const fmt = (s: string | null) =>
    s ? formatPrice(Number(s), currency) : ''

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-400">{shopName}</p>
          <h1 className="text-xl font-semibold">{t('myTitle')}</h1>
        </div>
      </header>

      {/* 认领 */}
      <form
        onSubmit={doClaim}
        className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <p className="text-sm font-medium">{t('claimTitle')}</p>
        <p className="text-xs text-zinc-500">{t('claimHint')}</p>
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder={t('anonPlate')}
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {t('claimBtn')}
          </button>
        </div>
        {claimErr && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {t(claimErr as never) ?? claimErr}
          </p>
        )}
      </form>

      {err && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {t(err as never) ?? err}
        </p>
      )}

      {/* 车辆卡片 */}
      {vehicles && vehicles.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {t('noVehicles')}
        </p>
      )}
      {vehicles?.map((v) => (
        <div
          key={v.id}
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold tracking-wide">{v.plate}</p>
              <p className="text-xs text-zinc-500">
                {[v.brand, v.model, v.year ? String(v.year) : null]
                  .filter(Boolean)
                  .join(' · ') || t('unnamed')}
              </p>
            </div>
            {(v.nextServiceKm != null || v.nextServiceDue) && (
              <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {t('nextService')}:{' '}
                {v.nextServiceKm != null
                  ? `${v.nextServiceKm}km`
                  : new Date(v.nextServiceDue as string).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* 当前在修单 */}
          {v.currentOrder ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
              <p className="text-xs text-zinc-500">
                {t('order')} #{v.currentOrder.displayNo}
              </p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {progressLabel(v.currentOrder.progress)}
                </span>
                <span className="text-sm font-semibold">
                  {fmt(v.currentOrder.total)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">{t('noActiveOrder')}</p>
          )}

          {/* 历史维保 */}
          {v.history.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
              <p className="text-xs text-zinc-400">{t('history')}</p>
              {v.history.slice(0, 5).map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-zinc-600 dark:text-zinc-300">
                    #{o.displayNo} ·{' '}
                    {new Date(o.createdAt).toLocaleDateString()}
                  </span>
                  <span className="text-zinc-500">{fmt(o.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <ToastView msg={msg} />
    </main>
  )
}
