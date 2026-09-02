'use client'
// 今日维修单列表：车牌 + 症状 + 进度状态 + 进度推进（老板一步一推，客户端只读可见）
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { getMotoOrders, getMotoPresetCatalog, addMotoItems, removeMotoItem, updateMotoOrderProgress, cancelMotoOrder, settleMotoOrder, searchMotoOrders } from '@/lib/moto-actions'
import { formatPrice } from '@/lib/format'
import { shopSubUrl } from '@/lib/urls'
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
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Awaited<ReturnType<typeof searchMotoOrders>> | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
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
      await settleMotoOrder(o.id, { paidAmount: amt, paymentMethod: 'cash' })
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

  const shown = orders.filter((o) => !filter || o.plate.includes(filter.trim().toUpperCase()))

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{t('todayOrders')}</h2>
        <span className="text-xs text-zinc-400">{shown.length}</span>
      </div>
      {/* M4.2 车牌筛选 / 搜索 */}
      <input
        value={filter}
        onChange={(e) => { setFilter(e.target.value); doSearch(e.target.value) }}
        placeholder={t('searchPlaceholder')}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">{t('needVehicle')}</p>
      ) : searchResults !== null ? (
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
