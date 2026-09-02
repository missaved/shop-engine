'use client'
// L4 订单列表：tab（洗涤中 / 待取 / 已结单）+ 推进/结单/收款/取消 + 逾期分级高亮（>3d/>7d）
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  getLaundryOrders,
  advanceLaundryStatus,
  rewashLaundry,
  cancelLaundryOrder,
  settleLaundry,
  getLaundryCustomer,
  payLaundryByBalance,
  payLaundryByCard,
  addLaundryClaim,
  confirmLaundryHandover,
  type LaundryProgress,
} from '@/lib/laundry-actions'
import { formatPrice } from '@/lib/format'
import type { LaundryOrderPlain, LaundryShop } from './types'

const STATUS_KEY: Record<string, string> = {
  washing_pending: 'progressWashingPending',
  submitted: 'progressSubmitted',
  washing: 'progressWashing',
  qc: 'progressQc',
  ready: 'progressReady',
  collected: 'progressCollected',
}

// 推进序列 + 下一态（含质检 QC / 再洗）
const SEQ: LaundryProgress[] = ['washing_pending', 'washing', 'qc', 'ready', 'collected']
const nextOf = (s: string | null): LaundryProgress | null => {
  const i = s ? SEQ.indexOf(s as LaundryProgress) : 0
  return SEQ[i + 1] ?? null
}

export function LaundryOrders({ currency, shop }: { currency: string; shop: LaundryShop }) {
  const t = useTranslations('laundry')
  const [orders, setOrders] = useState<LaundryOrderPlain[]>([])
  const [tab, setTab] = useState<LaundryProgress | 'all'>('washing')
  const [pays, setPays] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    try {
      setOrders(await getLaundryOrders())
    } catch {
      /* 忽略 */
    }
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load])

  // 需要默认收款值（=total-已收，即欠款）
  const defaultPay = (o: LaundryOrderPlain) => String(Number(o.total) - Number(o.paidAmount))

  const run = async (fn: () => Promise<unknown>, id: string) => {
    setBusyId(id)
    try {
      await fn()
      await load()
    } catch {
      alert('操作失败')
    } finally {
      setBusyId('')
    }
  }

  const filtered = orders.filter((o) => (tab === 'all' ? true : o.laundryStatus === tab))
  const submittedCount = orders.filter((o) => o.laundryStatus === 'submitted').length

  const tabLabel = (k: LaundryProgress | 'all') =>
    k === 'all' ? t('tabAll') : t(STATUS_KEY[k] ?? 'progressWashingPending')

  return (
    <section className="flex flex-col gap-3">
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {(['all', 'submitted', 'washing_pending', 'washing', 'qc', 'ready', 'collected'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === k ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'
            }`}
          >
            {tabLabel(k)}
            {k === 'submitted' && submittedCount > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">{submittedCount}</span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <p className="py-6 text-center text-sm text-zinc-400">{t('empty')}</p>}

      <div className="flex flex-col gap-3">
        {filtered.map((o) => {
          const debt = Number(o.total) - Number(o.paidAmount)
          const isReady = o.laundryStatus === 'ready'
          const next = nextOf(o.laundryStatus)
          const overdueDot =
            isReady && o.overdueClass === 2
              ? 'bg-red-500'
              : isReady && o.overdueClass === 1
                ? 'bg-amber-500'
                : 'bg-green-500'
          return (
            <div
              key={o.id}
              className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{o.displayNo}</span>
                  {o.tagCode && <span className="text-xs text-zinc-400">{o.tagCode}</span>}
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <span className={`h-2 w-2 rounded-full ${overdueDot}`} />
                    {t(STATUS_KEY[o.laundryStatus] ?? 'progressWashingPending')}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {debt > 0 ? (
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      {t('debtAmount', { amount: formatPrice(debt, currency) })}
                    </span>
                  ) : (
                    <span className="font-semibold text-green-600 dark:text-green-400">{t('allPaid')}</span>
                  )}
                </div>
              </div>

              {/* 明细：三模式摘要 */}
              <p className="mt-1 text-xs text-zinc-500">
                {o.mode === 'kg'
                  ? t('kgSummary', { kg: o.kg ?? 0 })
                  : o.mode === 'item'
                    ? o.itemNames.join(' · ')
                    : t('shoeSummary', { style: o.shoeStyle ?? '' })}
              </p>

              {/* P2 取送/护理/计件明细 */}
              {(o.dispatchType && o.dispatchType !== 'in_store') && (
                <p className="mt-1 text-xs text-zinc-500">
                  {o.dispatchType === 'pickup' ? t('dispatchPickup') : t('dispatchDeliver')}
                  {o.address ? ` · ${o.address}` : ''}
                  {o.timeWindow ? ` · ${o.timeWindow}` : ''}
                </p>
              )}
              {o.careType && o.careType !== 'normal' && (
                <p className="mt-1 text-xs text-zinc-500">{t('careTypeLabel')}: {o.careType}</p>
              )}
              {o.itemDetail.length > 0 && (
                <p className="mt-1 text-xs text-zinc-500">
                  {o.itemDetail.map((i) => `${i.name}×${i.count}${i.mark ? `(${i.mark})` : ''}`).join(' · ')}
                </p>
              )}
              {o.qcNote && <p className="mt-1 text-xs text-zinc-500">{t('qcNoteLabel')}: {o.qcNote}</p>}
              {o.claim.length > 0 && (
                <p className="mt-1 text-xs text-red-600">
                  {t('claimTitle')}: {o.claim.map((c) => `${c.type === 'lost' ? t('claimTypeLost') : t('claimTypeDamage')} · ${c.amount}`).join(' / ')}
                </p>
              )}

              {/* 逾期分级提示 */}
              {isReady && o.overdueClass > 0 && (
                <p className="mt-1 text-xs font-medium text-red-600">
                  {o.overdueClass === 2 ? t('overdue2') : t('overdue1')}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* 推进 / 结单（含质检） */}
                {next === 'qc' && (
                  <button
                    onClick={() => run(() => advanceLaundryStatus(o.id, 'qc'), o.id)}
                    disabled={busyId === o.id}
                    className="flex-1 rounded-lg bg-blue-500 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('sendQc')}
                  </button>
                )}
                {next === 'ready' && (
                  <button
                    onClick={() => run(() => advanceLaundryStatus(o.id, 'ready'), o.id)}
                    disabled={busyId === o.id}
                    className="flex-1 rounded-lg bg-amber-500 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('qcPass')}
                  </button>
                )}
                {next === 'collected' && (
                  <button
                    onClick={() => run(() => advanceLaundryStatus(o.id, 'collected'), o.id)}
                    disabled={busyId === o.id}
                    className="flex-1 rounded-lg bg-green-600 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('collect')}
                  </button>
                )}
                {next === 'washing' && (
                  <button
                    onClick={() => run(() => advanceLaundryStatus(o.id, 'washing'), o.id)}
                    disabled={busyId === o.id}
                    className="flex-1 rounded-lg bg-blue-500 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('startWashing')}
                  </button>
                )}
                {/* 顾客已提交 → 交接确认（出具正式凭证） */}
                {o.laundryStatus === 'submitted' && (
                  <button
                    onClick={() => run(() => confirmLaundryHandover(o.id), o.id)}
                    disabled={busyId === o.id}
                    className="flex-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('confirmHandover')}
                  </button>
                )}
                {/* 质检未过 → 再洗 */}
                {o.laundryStatus === 'qc' && (
                  <button
                    onClick={() => {
                      if (confirm(t('rewashConfirm'))) run(() => rewashLaundry(o.id, t('rewashDefault')), o.id)
                    }}
                    disabled={busyId === o.id}
                    className="rounded-lg border border-red-300 px-2 py-1.5 text-sm font-medium text-red-600 disabled:opacity-50 dark:border-red-800"
                  >
                    {t('rewash')}
                  </button>
                )}

                {/* 收款：欠款结算 */}
                {debt > 0 && (
                  <div className="flex flex-1 items-center gap-1">
                    <input
                      value={pays[o.id] ?? defaultPay(o)}
                      onChange={(e) => setPays((s) => ({ ...s, [o.id]: e.target.value }))}
                      inputMode="decimal"
                      className="w-20 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <button
                      onClick={() => run(() => settleLaundry(o.id, Number(pays[o.id] ?? defaultPay(o))), o.id)}
                      disabled={busyId === o.id}
                      className="rounded-lg bg-zinc-800 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {t('collectPay')}
                    </button>
                  </div>
                )}

                {/* P3 会员结账（扣储值 / 扣次卡）+ 记理赔 */}
                {o.customerPhone && debt > 0 && (
                  <button
                    onClick={() =>
                      run(async () => {
                        const c = await getLaundryCustomer(o.customerPhone!)
                        if (!c) throw new Error(t('noCustomer'))
                        await payLaundryByBalance(o.id, c.id, Number(o.total) - Number(o.paidAmount))
                      }, o.id)
                    }
                    disabled={busyId === o.id}
                    className="rounded-lg bg-violet-600 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('payByBalance')}
                  </button>
                )}
                {o.customerPhone && debt > 0 && (
                  <button
                    onClick={() =>
                      run(async () => {
                        const c = await getLaundryCustomer(o.customerPhone!)
                        const card = c?.cards?.find((x) => x.type === 'count' && (x.remainingCount ?? 0) > 0)
                        if (!card) throw new Error(t('noCard'))
                        await payLaundryByCard(o.id, card.id)
                      }, o.id)
                    }
                    disabled={busyId === o.id}
                    className="rounded-lg bg-violet-600 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('payByCard')}
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm(t('claimConfirm')))
                      run(async () => {
                        await addLaundryClaim(o.id, { type: 'damage', resolution: 'refund', amount: debt })
                      }, o.id)
                  }}
                  disabled={busyId === o.id}
                  className="rounded-lg border border-red-300 px-2 py-1.5 text-sm font-medium text-red-600 disabled:opacity-50 dark:border-red-800"
                >
                  {t('addClaim')}
                </button>

                {/* 取消 */}
                {o.laundryStatus !== 'collected' && (
                  <button
                    onClick={() => {
                      if (confirm(t('confirmCancel'))) run(() => cancelLaundryOrder(o.id), o.id)
                    }}
                    disabled={busyId === o.id}
                    className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
                  >
                    {t('cancel')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
