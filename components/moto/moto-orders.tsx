'use client'
// 今日维修单列表：车牌 + 症状 + 进度状态 + 进度推进（老板一步一推，客户端只读可见）
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { getMotoOrders, updateMotoOrderProgress, cancelMotoOrder, settleMotoOrder } from '@/lib/moto-actions'
import { formatPrice } from '@/lib/format'
import { shopSubUrl } from '@/lib/urls'
import type { Vertical } from '@/lib/vertical'

type MotoOrder = {
  id: string
  displayNo: string
  status: string
  progress: string | null
  plate: string
  symptom: string[]
  estimatedDue: string | null
  total: string
  paidAmount: string
  createdAt: string
}

// 推进序列（与 lib/moto-actions PROGRESS_SEQ 一致）
const SEQ = ['queued', 'diagnosing', 'quoted', 'repairing', 'waiting_pickup', 'picked_up']
const nextOf = (p: string | null) => (p ? SEQ[SEQ.indexOf(p) + 1] : undefined)

export function MotoOrders({
  vertical,
  slug,
  currency,
  city,
}: {
  vertical: Vertical
  slug: string
  currency: string
  /** 城市段（工厂 DEFAULT_CITY 兜底；DB 读出 shop.city 为 string，父级传 shop.city） */
  city?: string
}) {
  const t = useTranslations('moto')
  const router = useRouter()
  const [orders, setOrders] = useState<MotoOrder[]>([])
  const [busyId, setBusyId] = useState('')
  // 每单实收金额暂存（默认=total，可改少=部分收款/记欠款）
  const [pays, setPays] = useState<Record<string, string>>({})
  // M4.2 车牌筛选（纯前端过滤，normalize 后大写精确包含）
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    try {
      setOrders(await getMotoOrders())
    } catch {
      /* 忽略刷新失败 */
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000) // 30s 轮询（新单自动出现）
    return () => clearInterval(timer)
  }, [load])

  const advance = async (o: MotoOrder) => {
    const next = nextOf(o.progress)
    if (!next) return
    setBusyId(o.id)
    try {
      // M6b 交接（picked_up）时 updateMotoOrderProgress 返回 ticketId → 跳凭证页发客户
      const r = await updateMotoOrderProgress(o.id, next as never)
      await load()
      if (next === 'picked_up' && r?.ticketId) {
        router.push(shopSubUrl({ vertical, slug, city }, 'ticket', { ticketId: r.ticketId }))
      }
    } finally {
      setBusyId('')
    }
  }

  const cancel = async (o: MotoOrder) => {
    if (!confirm(`${t('cancel')} ${o.displayNo}?`)) return
    setBusyId(o.id)
    try {
      await cancelMotoOrder(o.id)
      await load()
    } finally {
      setBusyId('')
    }
  }

  // 收款（补录实收）：填 fulltotal=结清；填少=部分收款记欠款；交车后(picked_up)亦可补录
  const collect = async (o: MotoOrder) => {
    const amt = Number.parseFloat(pays[o.id] ?? String(o.total))
    if (!Number.isFinite(amt) || amt < 0) return
    setBusyId(o.id)
    try {
      await settleMotoOrder(o.id, { paidAmount: amt, paymentMethod: 'cash' })
      await load()
    } finally {
      setBusyId('')
    }
  }

  const shown = orders.filter((o) => !filter || o.plate.includes(filter.trim().toUpperCase()))

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{t('todayOrders')}</h2>
        <span className="text-xs text-zinc-400">{shown.length}</span>
      </div>
      {/* M4.2 车牌筛选 */}
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t('searchPlaceholder')}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">{t('needVehicle')}</p>
      ) : (
        <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {shown.map((o) => {
            const next = nextOf(o.progress)
            const done = o.progress === 'picked_up' || o.status === 'CANCELLED'
            return (
              <div key={o.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold tracking-wider">{o.plate}</span>
                    <span className="text-xs text-zinc-400">{o.displayNo}</span>
                  </div>
                  <span className="text-sm font-semibold">{formatPrice(Number(o.total), currency)}</span>
                </div>
                {o.symptom.length > 0 && (
                  <div className="mt-0.5 truncate text-xs text-zinc-500">{o.symptom.join('、')}</div>
                )}
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    {o.progress ? t(o.progress as never) : o.status}
                  </span>
                  {o.estimatedDue && <span className="text-xs text-zinc-400">{o.estimatedDue}</span>}
                </div>
                {!done && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => advance(o)}
                      disabled={busyId === o.id || !next}
                      className="flex-1 rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      {next ? `→ ${t(next as never)}` : '…'}
                    </button>
                    <button
                      onClick={() => cancel(o)}
                      disabled={busyId === o.id}
                      className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-red-600 dark:border-zinc-700"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                )}
                {/* 收款（补录实收）：picked_up 后 done 但仍可收款；取消单禁止 */}
                {o.status !== 'CANCELLED' && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      inputMode="decimal"
                      value={pays[o.id] ?? String(o.total)}
                      onChange={(e) => setPays((p) => ({ ...p, [o.id]: e.target.value }))}
                      placeholder={t('amountReceived')}
                      className="w-28 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    {Number(o.total) > 0 && (
                      <button
                        type="button"
                        onClick={() => setPays((p) => ({ ...p, [o.id]: String(o.total) }))}
                        disabled={busyId === o.id}
                        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        {t('collectFull')}
                      </button>
                    )}
                    <button
                      onClick={() => collect(o)}
                      disabled={busyId === o.id}
                      className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white disabled:opacity-40"
                    >
                      {t('pay')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
