'use client'
// L4 订单列表：tab（洗涤中 / 待取 / 已结单）+ 推进/结单/收款/取消 + 逾期分级高亮（>3d/>7d）
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  getLaundryOrders,
  advanceLaundryStatus,
  rewashLaundry,
  settleLaundry,
  getLaundryCustomer,
  payLaundryByBalance,
  payLaundryByCard,
  addLaundryClaim,
  confirmLaundryHandover,
  searchLaundryOrders,
  type LaundryProgress,
} from '@/lib/laundry-actions'
import { formatPrice } from '@/lib/format'
import type { LaundryOrderPlain, LaundryShop } from './types'

// 订单时间：dd/MM HH:mm（折叠行展示用，照 food order-list）
function formatTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const STATUS_KEY: Record<string, string> = {
  washing_pending: 'progressWashingPending',
  submitted: 'progressSubmitted',
  washing: 'progressWashing',
  qc: 'progressQc',
  ready: 'progressReady',
  collected: 'progressCollected',
}

// 状态配色（对齐 food order-list：左色条 + 状态徽标）
const STATUS_STYLE: Record<string, { badge: string; bar: string }> = {
  submitted: { badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', bar: 'border-l-amber-400' },
  washing_pending: { badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300', bar: 'border-l-zinc-300' },
  washing: { badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', bar: 'border-l-blue-400' },
  qc: { badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', bar: 'border-l-indigo-400' },
  ready: { badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', bar: 'border-l-green-400' },
  collected: { badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300', bar: 'border-l-zinc-300' },
  cancelled: { badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', bar: 'border-l-red-400' },
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
  const [pays, setPays] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')
  const [settleOpenId, setSettleOpenId] = useState<string | null>(null)
  const [showAllCollected, setShowAllCollected] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<LaundryOrderPlain[] | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const doSearch = async (q: string) => {
    const query = (q ?? '').trim()
    if (!query) { setSearchResults(null); return }
    setSearchBusy(true)
    try { setSearchResults(await searchLaundryOrders(query)) } catch { setSearchResults([]) } finally { setSearchBusy(false) }
  }

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

  // Block E：订单卡默认折叠成一行（单号｜状态｜时间｜金额），点展开、10s 自动收回（照 food order-list）
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const isFolded = (o: LaundryOrderPlain) => collapsed[o.id] ?? true
  const collapseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const scheduleAutoCollapse = useCallback((id: string) => {
    const timers = collapseTimersRef.current
    const prev = timers.get(id)
    if (prev) clearTimeout(prev)
    timers.set(
      id,
      setTimeout(() => {
        setCollapsed((prev) => ({ ...prev, [id]: true }))
        timers.delete(id)
      }, 10_000),
    )
  }, [])
  const expandOrder = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: false }))
    scheduleAutoCollapse(id)
  }
  // 卸载时清空所有自动收回计时器（防泄漏）
  useEffect(() => {
    const timers = collapseTimersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  // A3 次要行：复制摘要 / 发Zalo（复用 laundry-ticket 文案结构）
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const buildText = (o: LaundryOrderPlain) => {
    const tag = o.tagCode ? `(${o.tagCode})` : ''
    return [shop.name, o.displayNo, o.customerName || o.customerPhone, formatPrice(Number(o.total), currency)].filter(Boolean).join(' · ')
  }
  const copySummary = (o: LaundryOrderPlain) => {
    const text = buildText(o)
    ;(navigator.clipboard?.writeText?.(text) ?? Promise.reject()).catch(() => {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }).finally(() => setCopiedId(o.id))
    setTimeout(() => setCopiedId(null), 1500)
  }
  const sendZalo = (o: LaundryOrderPlain) => {
    copySummary(o)
    const phone = (o.customerPhone ?? '').replace(/[^0-9+]/g, '')
    if (phone) window.open(`https://zalo.me/${phone}`, '_blank')
  }

  // 进行中集合（与 countLaundryActive 的 ACTIVE 一致）：这些单恒显、置顶
  const ACTIVE = ['submitted', 'washing_pending', 'washing', 'qc', 'ready']
  // 终态(已结单)只显示当天（UTC+7 业务日，vs food 一致）；有开关可查看全部历史
  const isTodayVN = (iso: string) => {
    const off = 7 * 60 * 60 * 1000
    const day = (ms: number) => new Date(ms + off).toISOString().slice(0, 10)
    return day(new Date(iso).getTime()) === day(Date.now())
  }
  // 平铺规则（用户定稿 ①②③）：进行中置顶 / 终态仅当天 / 取消单默认隐藏（查全部可翻到）
  const isActive = (o: LaundryOrderPlain) => ACTIVE.includes(o.laundryStatus)
  const shown = orders.filter((o) => {
    if (o.status === 'CANCELLED') return showAllCollected // ③ 取消单仅"查全部"可见
    if (isActive(o)) return true // ① 进行中恒显
    return showAllCollected || isTodayVN(o.createdAt) // ② 终态仅当天（collected）
  })
  // ① 进行中置顶、终态沉底；各组内按 createdAt desc（后端已 desc）
  const activeList = shown.filter(isActive)
  const terminalList = shown.filter((o) => !isActive(o))
  const ordered = [...activeList, ...terminalList]

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          value={searchQ}
          onChange={(e) => { setSearchQ(e.target.value); doSearch(e.target.value) }}
          placeholder={t('searchPlaceholder')}
          className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
        <button onClick={() => doSearch(searchQ)} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">{searchBusy ? '…' : t('search')}</button>
      </div>
      {searchResults !== null && (
        <div className="flex flex-col gap-3">
          {searchResults.length === 0 && <p className="py-6 text-center text-sm text-zinc-400">{t('histEmpty')}</p>}
          {searchResults.map((o) => {
            const debt = Number(o.total) - Number(o.paidAmount)
            const next = nextOf(o.laundryStatus)
            const st = STATUS_STYLE[o.laundryStatus ?? ''] ?? STATUS_STYLE.cancelled
            return (
              <div key={o.id} className={`rounded-xl border border-l-4 border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${st.bar}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{o.displayNo}</span>
                    {o.tagCode && <span className="text-xs text-zinc-400">{o.tagCode}</span>}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.badge}`}>{t(STATUS_KEY[o.laundryStatus] ?? 'progressWashingPending')}</span>
                  </div>
                  <span className="text-sm font-medium">{formatPrice(Number(o.total), currency)}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{o.customerName || o.customerPhone || ''}</p>
              </div>
            )
          })}
        </div>
      )}
      {searchResults === null && (
        <button
          onClick={() => setShowAllCollected((v) => !v)}
          className="self-start text-xs text-zinc-500 underline"
        >
          {showAllCollected ? t('todayOnly') : t('viewAll')}
        </button>
      )}
      <div className="flex flex-col gap-3">
        {ordered.map((o) => {
          const debt = Number(o.total) - Number(o.paidAmount)
          const isReady = o.laundryStatus === 'ready'
          const next = nextOf(o.laundryStatus)
          const overdueDot =
            isReady && o.overdueClass === 2
              ? 'bg-red-500'
              : isReady && o.overdueClass === 1
                ? 'bg-amber-500'
                : 'bg-green-500'
          const st = STATUS_STYLE[o.laundryStatus ?? ''] ?? STATUS_STYLE.cancelled
          // Block E：默认折叠成一行（单号｜状态｜时间｜金额），点展开、10s 自动收回
          const folded = isFolded(o)
          if (folded) {
            return (
              <div
                key={o.id}
                onClick={() => expandOrder(o.id)}
                className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-center gap-2 text-left">
                  <span className="text-xs text-zinc-400">▸</span>
                  <span className="font-medium">{o.displayNo}</span>
                  {o.laundryStatus && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.badge}`}>{t(STATUS_KEY[o.laundryStatus] ?? 'progressWashingPending')}</span>
                  )}
                  <span className="text-xs text-zinc-400">{formatTime(o.createdAt)}</span>
                </div>
                <span className="font-medium">{formatPrice(Number(o.total), currency)}</span>
              </div>
            )
          }
          return (
            <div
              key={o.id}
              className={`rounded-xl border border-l-4 border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${st.bar}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{o.displayNo}</span>
                  <button
                    onClick={() => setCollapsed((prev) => ({ ...prev, [o.id]: true }))}
                    className="text-xs text-zinc-400 hover:text-zinc-600"
                  >
                    ▾
                  </button>
                  {o.tagCode && <span className="text-xs text-zinc-400">{o.tagCode}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.badge}`}>{t(STATUS_KEY[o.laundryStatus] ?? 'progressWashingPending')}</span>
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <span className={`h-2 w-2 rounded-full ${overdueDot}`} />
                    {t(STATUS_KEY[o.laundryStatus] ?? 'progressWashingPending')}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {debt <= 0 ? (
                    <span className="font-semibold text-green-600 dark:text-green-400">{t('paid')}</span>
                  ) : Number(o.paidAmount) > 0 ? (
                    <span className="font-semibold text-amber-600 dark:text-amber-400">{t('partial')} · {t('debtAmount', { amount: formatPrice(debt, currency) })}</span>
                  ) : (
                    <span className="font-semibold text-zinc-500 dark:text-zinc-400">{t('unpaid')} · {t('debtAmount', { amount: formatPrice(debt, currency) })}</span>
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
                    className="w-full rounded-lg bg-blue-500 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('sendQc')}
                  </button>
                )}
                {next === 'ready' && (
                  <button
                    onClick={() => run(() => advanceLaundryStatus(o.id, 'ready'), o.id)}
                    disabled={busyId === o.id}
                    className="w-full rounded-lg bg-amber-500 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('qcPass')}
                  </button>
                )}
                {next === 'collected' && (
                  <button
                    onClick={() => run(() => advanceLaundryStatus(o.id, 'collected'), o.id)}
                    disabled={busyId === o.id}
                    className="w-full rounded-lg bg-green-600 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('collect')}
                  </button>
                )}
                {next === 'washing' && (
                  <button
                    onClick={() => run(() => advanceLaundryStatus(o.id, 'washing'), o.id)}
                    disabled={busyId === o.id}
                    className="w-full rounded-lg bg-blue-500 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('startWashing')}
                  </button>
                )}
                {/* 顾客已提交 → 交接确认（出具正式凭证） */}
                {o.laundryStatus === 'submitted' && (
                  <button
                    onClick={() => run(() => confirmLaundryHandover(o.id), o.id)}
                    disabled={busyId === o.id}
                    className="w-full rounded-lg bg-emerald-600 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
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

                {/* 收款：收进「收款」展开面板（方式+实收+收全款/抹零+会员+理赔） */}
                {debt > 0 && (
                  <>
                    <button
                      onClick={() => setSettleOpenId(settleOpenId === o.id ? null : o.id)}
                      disabled={busyId === o.id}
                      className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      {settleOpenId === o.id ? '× ' : ''}{t('collectPay')}
                    </button>
                    {settleOpenId === o.id && (
                      <div className="flex w-full flex-col gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-3 dark:border-amber-700 dark:bg-amber-950/20">
                        <div className="flex items-center gap-2">
                          <input
                            value={pays[o.id] ?? defaultPay(o)}
                            onChange={(e) => setPays((s) => ({ ...s, [o.id]: e.target.value }))}
                            inputMode="decimal"
                            className="flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                          />
                          <button
                            onClick={() => run(() => settleLaundry(o.id, Number(pays[o.id] ?? defaultPay(o))), o.id)}
                            disabled={busyId === o.id}
                            className="rounded-lg bg-zinc-800 px-2 py-1 text-sm font-medium text-white disabled:opacity-50"
                          >
                            {t('collectPay')}
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setPays((s) => ({ ...s, [o.id]: String(debt) }))} className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{t('collectAll')}</button>
                          <button onClick={() => setPays((s) => ({ ...s, [o.id]: String(Math.floor(debt / 1000) * 1000) }))} className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{t('roundToK')}</button>
                        </div>
                        {o.customerPhone && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => run(async () => { const c = await getLaundryCustomer(o.customerPhone!); if (!c) throw new Error(t('noCustomer')); await payLaundryByBalance(o.id, c.id, Number(o.total) - Number(o.paidAmount)) }, o.id)}
                              disabled={busyId === o.id}
                              className="flex-1 rounded-lg bg-violet-600 px-2 py-1 text-sm font-medium text-white disabled:opacity-50"
                            >{t('payByBalance')}</button>
                            <button
                              onClick={() => run(async () => { const c = await getLaundryCustomer(o.customerPhone!); const card = c?.cards?.find((x) => x.type === 'count' && (x.remainingCount ?? 0) > 0); if (!card) throw new Error(t('noCard')); await payLaundryByCard(o.id, card.id) }, o.id)}
                              disabled={busyId === o.id}
                              className="flex-1 rounded-lg bg-violet-600 px-2 py-1 text-sm font-medium text-white disabled:opacity-50"
                            >{t('payByCard')}</button>
                          </div>
                        )}
                        <button
                          onClick={() => { if (confirm(t('claimConfirm'))) run(async () => { await addLaundryClaim(o.id, { type: 'damage', resolution: 'refund', amount: debt }) }, o.id) }}
                          disabled={busyId === o.id}
                          className="w-full rounded-lg border border-red-300 px-2 py-1 text-sm font-medium text-red-600 disabled:opacity-50 dark:border-red-800"
                        >{t('addClaim')}</button>
                      </div>
                    )}
                  </>
                )}
                {/* A3 次要行：复制摘要 / 发Zalo */}
                <div className="flex w-full gap-2">
                  <button onClick={() => copySummary(o)} className="flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-xs min-h-[44px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{copiedId === o.id ? '✓' : t('copySummary')}</button>
                  <button onClick={() => sendZalo(o)} className="flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-xs min-h-[44px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{t('sendZalo')}</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
