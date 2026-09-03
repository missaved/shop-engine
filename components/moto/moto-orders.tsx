'use client'
// 今日维修单列表：车牌 + 症状 + 进度状态 + 进度推进（老板一步一推，客户端只读可见）
// Block D：默认折叠成一行 + 支付三态着色 + 收款面板化 + 次要行；平铺 ①②③（进行中置顶/终态仅当天/取消单默认隐藏）
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { getMotoOrders, getMotoPresetCatalog, addMotoItems, removeMotoItem, updateMotoOrderProgress, cancelMotoOrder, settleMotoOrder, searchMotoOrders } from '@/lib/moto-actions'
import { formatPrice } from '@/lib/format'
import { shopSubUrl } from '@/lib/urls'
import { useToast } from '@/components/dashboard/use-toast'
import type { Vertical } from '@/lib/vertical'
import type { MotoServiceItem } from './types'

// 加项下拉用全库预设（getMotoPresetCatalog），与开单向导「本店大按钮」不同源
type CatalogItem = {
  serviceKey: string
  nameVi: string
  price: string
}

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
  // P2-AP：维修中加/删服务项展示
  items: MotoServiceItem[]
}

// 支付三态（照 food order-list）：0=未付，0<实收<total=部分付，≥total=已付
function paymentState(o: MotoOrder): 'unpaid' | 'partial' | 'paid' {
  const total = Number(o.total)
  const paid = Number(o.paidAmount)
  if (paid <= 0) return 'unpaid'
  if (paid < total) return 'partial'
  return 'paid'
}

// 时间 dd/MM HH:mm（折叠行展示用，照 food order-list）
function formatTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 推进序列（与 lib/moto-actions PROGRESS_SEQ 一致）
const SEQ = ['queued', 'diagnosing', 'quoted', 'repairing', 'waiting_pickup', 'picked_up']
const nextOf = (p: string | null) => (p ? SEQ[SEQ.indexOf(p) + 1] : undefined)

export function MotoOrders({
  vertical,
  slug,
  currency,
  city,
  shopName,
  shopPhone,
}: {
  vertical: Vertical
  slug: string
  currency: string
  /** 城市段（工厂 DEFAULT_CITY 兜底；DB 读出 shop.city 为 string，父级传 shop.city） */
  city?: string
  /** 店名（摘要/发Zalo 用） */
  shopName: string
  shopPhone?: string | null
}) {
  const t = useTranslations('moto')
  const td = useTranslations('dashboard')
  const router = useRouter()
  const { show } = useToast()
  const [orders, setOrders] = useState<MotoOrder[]>([])
  const [busyId, setBusyId] = useState('')
  // 每单实收金额暂存（默认=total，可改少=部分收款/记欠款）
  const [pays, setPays] = useState<Record<string, string>>({})
  // D4/决策⑨ 支付方式（现金/扫码/其他），按单存，默认现金（照 food）
  const [paymentMethod, setPaymentMethod] = useState<Record<string, string>>({})
  // D4 收款面板展开（点「收款」展开，一次一单；样式照 food）
  const [settleOpenId, setSettleOpenId] = useState<string | null>(null)
  // M4.2 车牌筛选（纯前端过滤，normalize 后大写精确包含）
  const [filter, setFilter] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Awaited<ReturnType<typeof searchMotoOrders>> | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  // 平铺 ③：查看全部历史（终态仅当天 + 取消单默认隐藏；照 laundry showAllCollected）
  const [showAll, setShowAll] = useState(false)
  const doSearch = async (q: string) => {
    const query = (q ?? '').trim()
    if (!query) { setSearchResults(null); return }
    setSearchBusy(true)
    try { setSearchResults(await searchMotoOrders(query)) } catch { setSearchResults([]) } finally { setSearchBusy(false) }
  }
  // P2-AP 加/删服务项：一次展开一单（addOpenId）；全库预设下拉（catalog）+ 选中 key + 数量
  const [addOpenId, setAddOpenId] = useState('')
  const [addServiceKey, setAddServiceKey] = useState('')
  const [addQty, setAddQty] = useState('1')
  const [catalog, setCatalog] = useState<CatalogItem[]>([])

  // Block D：默认折叠成一行，点展开、10s 自动收回（照 food/laundry 折叠机制）
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const isFolded = (o: MotoOrder) => collapsed[o.id] ?? true
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
  function expandOrder(id: string) {
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

  // D3 次要行：复制摘要 / 发Zalo（照 laundry buildText + clipboard fallback）
  const buildText = (o: MotoOrder) => {
    const parts = [
      shopName,
      o.displayNo,
      o.plate,
      ...o.symptom,
      ...o.items.map((i) => `${i.name} x${i.qty}`),
      formatPrice(Number(o.total), currency),
    ]
    return parts.filter(Boolean).join(' · ')
  }
  const copySummary = (o: MotoOrder) => {
    const text = buildText(o)
    ;(navigator.clipboard?.writeText?.(text) ?? Promise.reject()).catch(() => {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }).finally(() => setCopiedId(o.id))
    setCopiedId(o.id)
    show(t('toastCopied'))
    setTimeout(() => setCopiedId(null), 1500)
  }
  const sendZalo = (o: MotoOrder) => {
    copySummary(o)
    const phone = (shopPhone ?? '').replace(/[^0-9+]/g, '')
    if (phone) window.open(`https://zalo.me/${phone}`, '_blank')
    else show(t('toastError'))
  }

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

  // P2-AP：加项下拉数据（全库预设；加载后默认选中第一个，便于直接确认）
  useEffect(() => {
    getMotoPresetCatalog()
      .then((rows) => {
        setCatalog(rows)
        setAddServiceKey((k) => k || rows[0]?.serviceKey || '')
      })
      .catch(() => setCatalog([]))
  }, [])

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
      await settleMotoOrder(o.id, { paidAmount: amt, paymentMethod: (paymentMethod[o.id] as 'cash' | 'qr' | 'other') ?? 'cash' })
      await load()
    } finally {
      setBusyId('')
    }
  }

  // P2-AP 加服务项：服务端计价，客户端只传 serviceKey+qty（不传价）
  const addItem = async (o: MotoOrder) => {
    const key = addServiceKey || catalog[0]?.serviceKey
    if (!key) return
    setBusyId(o.id)
    try {
      await addMotoItems(o.id, [{ serviceKey: key, qty: Number(addQty || '1') }])
      await load()
    } finally {
      setBusyId('')
    }
  }

  // P2-AP 删服务项：按行 index
  const removeItem = async (o: MotoOrder, idx: number) => {
    setBusyId(o.id)
    try {
      await removeMotoItem(o.id, idx)
      await load()
    } finally {
      setBusyId('')
    }
  }

  // 平铺 ①②③（决策⑦ laundry+moto 统一）：进行中置顶 / 终态仅当天(UTC+7) / 取消单默认隐藏
  const isStatusDone = (o: MotoOrder) => o.progress === 'picked_up' || o.status === 'CANCELLED'
  const isActiveMoto = (o: MotoOrder) => !isStatusDone(o)
  const isTodayVN = (iso: string) => {
    const off = 7 * 60 * 60 * 1000
    const day = (ms: number) => new Date(ms + off).toISOString().slice(0, 10)
    return day(new Date(iso).getTime()) === day(Date.now())
  }
  // 车牌筛选（核心入口）→ 平铺过滤 → 进行中置顶/终态沉底（组内后端已 desc）
  const shown = orders.filter((o) => !filter || o.plate.includes(filter.trim().toUpperCase()))
  const visible = shown.filter((o) => {
    if (o.status === 'CANCELLED') return showAll // ③ 取消单仅"查全部"可见
    if (isActiveMoto(o)) return true // ① 进行中恒显
    return showAll || isTodayVN(o.createdAt) // ② 终态(picked_up)仅当天
  })
  const activeList = visible.filter(isActiveMoto)
  const terminalList = visible.filter((o) => !isActiveMoto(o))
  const ordered = [...activeList, ...terminalList]

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{t('todayOrders')}</h2>
        <span className="text-xs text-zinc-400">{ordered.length}</span>
      </div>
      {/* M4.2 车牌筛选 / 搜索 */}
      <input
        value={filter}
        onChange={(e) => { setFilter(e.target.value); doSearch(e.target.value) }}
        placeholder={t('searchPlaceholder')}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {searchResults !== null ? (
        <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {searchResults.length === 0 && <p className="py-4 text-center text-sm text-zinc-400">{t('noMatch')}</p>}
          {searchResults.map((o) => (
            <div key={o.id} className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{o.displayNo}</span>
                <span className="text-xs font-bold tracking-wider text-zinc-500">{o.plate}</span>
                <span className="text-xs text-zinc-400">{o.progress ? t(o.progress as never) : o.status}</span>
              </div>
              <span className="text-sm font-medium">{formatPrice(Number(o.total), currency)}</span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* 平铺开关：查看全部历史（含更早终态 + 取消单） */}
          <button
            onClick={() => setShowAll((v) => !v)}
            className="self-start text-xs text-zinc-500 underline"
          >
            {showAll ? t('todayOnly') : t('viewAll')}
          </button>
          {ordered.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-400">{t('needVehicle')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {ordered.map((o) => {
                const debt = Math.max(0, Number(o.total) - Number(o.paidAmount))
                const state = paymentState(o)
                const next = nextOf(o.progress)
                const done = o.progress === 'picked_up' || o.status === 'CANCELLED'
                // Block D：默认折叠成一行（车牌｜状态｜时间｜金额），点展开、10s 自动收回
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
                        <span className="font-bold tracking-wider">{o.plate}</span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          {o.progress ? t(o.progress as never) : o.status}
                        </span>
                        <span className="text-xs text-zinc-400">{formatTime(o.createdAt)}</span>
                      </div>
                      <span className="font-medium">{formatPrice(Number(o.total), currency)}</span>
                    </div>
                  )
                }
                return (
                  <div
                    key={o.id}
                    className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold tracking-wider">{o.plate}</span>
                        <button
                          onClick={() => setCollapsed((prev) => ({ ...prev, [o.id]: true }))}
                          className="text-xs text-zinc-400 hover:text-zinc-600"
                        >
                          ▾
                        </button>
                        <span className="text-xs text-zinc-400">{o.displayNo}</span>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        {o.progress ? t(o.progress as never) : o.status}
                      </span>
                    </div>
                    {o.symptom.length > 0 && (
                      <div className="mt-1 truncate text-sm text-zinc-500">{o.symptom.join('、')}</div>
                    )}
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-xs text-zinc-400">{o.progress ? t(o.progress as never) : o.status}</span>
                      {o.estimatedDue && <span className="text-xs text-zinc-400">{o.estimatedDue}</span>}
                    </div>
                    {/* D2 支付三态着色（已收/部分/未收+欠款） */}
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="font-semibold">{formatPrice(Number(o.total), currency)}</span>
                      <span
                        className={
                          state === 'paid'
                            ? 'text-green-700 dark:text-green-300'
                            : state === 'partial'
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-zinc-500'
                        }
                      >
                        {t(state === 'paid' ? 'paid' : state === 'partial' ? 'partial' : 'unpaid')}
                        {state !== 'paid' ? ` · ${t('debtAmount', { amount: formatPrice(debt, currency) })}` : ''}
                      </span>
                    </div>
                    {!done && (
                      <>
                        <div className="mt-2 flex flex-col gap-2">
                          <button
                            onClick={() => advance(o)}
                            disabled={busyId === o.id || !next}
                            className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                          >
                            {next ? `→ ${t(next as never)}` : '…'}
                          </button>
                          <button
                            onClick={() => cancel(o)}
                            disabled={busyId === o.id}
                            className="w-full rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 disabled:opacity-40 dark:border-red-800"
                          >
                            {t('cancel')}
                          </button>
                        </div>
                        {/* P2-AP 维修中加/删服务项：一次展开一单；全库预设下拉 + 当前 items 列表 */}
                        <div className="mt-2">
                          <button
                            onClick={() => setAddOpenId(addOpenId === o.id ? '' : o.id)}
                            disabled={busyId === o.id}
                            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                          >
                            {t('addItem')}
                          </button>
                          {addOpenId === o.id && (
                            <div className="mt-2 rounded-lg border border-dashed border-amber-300 p-2 dark:border-amber-600">
                              <div className="flex gap-2">
                                <select
                                  value={addServiceKey}
                                  onChange={(e) => setAddServiceKey(e.target.value)}
                                  className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                >
                                  {catalog.map((p) => (
                                    <option key={p.serviceKey} value={p.serviceKey}>
                                      {p.nameVi}（{formatPrice(Number(p.price), currency)}）
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  value={addQty}
                                  onChange={(e) => setAddQty(e.target.value)}
                                  min="1"
                                  className="w-16 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                />
                                <button
                                  onClick={() => addItem(o)}
                                  disabled={busyId === o.id || !addServiceKey}
                                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                                >
                                  {t('confirmAdd')}
                                </button>
                              </div>
                              {o.items.length > 0 ? (
                                <div className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
                                  {o.items.map((it, idx) => (
                                    <div key={idx} className="flex items-center justify-between py-1.5 text-sm">
                                      <span>
                                        {it.name} ×{it.qty}
                                        <span className="ml-1 text-xs text-zinc-400">
                                          {it.kind === 'part' ? t('partFee') : t('laborFee')}
                                        </span>
                                      </span>
                                      <span className="flex items-center gap-2">
                                        <span>{formatPrice(it.price * it.qty, currency)}</span>
                                        <button
                                          onClick={() => removeItem(o, idx)}
                                          disabled={busyId === o.id}
                                          className="text-red-500"
                                        >
                                          {t('removeItem')}
                                        </button>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-2 text-xs text-zinc-400">{t('noService')}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    {/* D4 收款面板化（决策⑨）：非取消单显示「× 收款」→ 展开面板（支付三选+实收+收全款+确认）；取消单禁止 */}
                    {o.status !== 'CANCELLED' && (
                      <div className="mt-2">
                        {settleOpenId === o.id ? (
                          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-3 dark:border-amber-700 dark:bg-amber-950/20">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">{td('settleTitle')}</span>
                              <button
                                onClick={() => setSettleOpenId(null)}
                                className="text-xs text-zinc-400 hover:text-zinc-600"
                              >
                                {t('cancel')}
                              </button>
                            </div>
                            <div className="mb-2 flex gap-2">
                              {(['cash', 'qr', 'other'] as const).map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setPaymentMethod((prev) => ({ ...prev, [o.id]: m }))}
                                  className={`flex-1 rounded-md border px-2.5 py-2 text-xs transition-colors ${
                                    (paymentMethod[o.id] ?? 'cash') === m
                                      ? 'border-amber-500 bg-amber-500 text-white'
                                      : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                                  }`}
                                >
                                  {td(m === 'cash' ? 'payCash' : m === 'qr' ? 'payQr' : 'payOther')}
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                inputMode="decimal"
                                value={pays[o.id] ?? String(o.total)}
                                onChange={(e) => setPays((p) => ({ ...p, [o.id]: e.target.value }))}
                                placeholder={t('amountReceived')}
                                className="w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
                                className="ml-auto rounded-md border border-amber-500 bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:brightness-105 disabled:opacity-60"
                              >
                                {td('settleConfirm')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSettleOpenId(settleOpenId === o.id ? null : o.id)}
                            disabled={busyId === o.id}
                            className="w-full rounded-lg border border-zinc-300 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                          >
                            {t('pay')}
                          </button>
                        )}
                      </div>
                    )}
                    {/* D3 次要行：复制摘要 / 发Zalo */}
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => copySummary(o)}
                        className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        {copiedId === o.id ? '✓' : td('copySummary')}
                      </button>
                      <button
                        onClick={() => sendZalo(o)}
                        className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        {t('sendZalo')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}
