'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  advanceOrderStatus,
  cancelOrder,
  getLatestOrderNo,
  setOrderPaidAmount,
} from '@/lib/actions'
import { useToast, ToastView } from './use-toast'
import { formatPrice } from '@/lib/format'

// 订单与店铺的序列化类型（server component 已把 Decimal/Date 转成基础类型）
export type OrderItem = {
  name: string
  qty: number
  price: number | string
  extras?: { name: string; price: number | string }[]
  options?: { group: string; name: string; price: number | string }[]
}
export type OrderPlain = {
  id: string
  orderNo: number
  displayNo: string
  total: string
  paidAmount: string
  customerName: string | null
  customerPhone: string | null
  status: string
  note: string | null
  orderType: string | null
  tableNo: string | null
  createdAt: string
  items: OrderItem[]
}
export type ShopPlain = {
  id: string
  name: string
  phone: string | null
  open: boolean
  config: { openHours?: string; minOrderAmount?: number; deliveryFee?: number } | null
}

// 支付三态：0=未付，0<实收<total=部分付，≥total=已付
function paymentState(order: OrderPlain): 'unpaid' | 'partial' | 'paid' {
  const total = Number(order.total)
  const paid = Number(order.paidAmount)
  if (paid <= 0) return 'unpaid'
  if (paid < total) return 'partial'
  return 'paid'
}

// 订单状态 → 本地化 key（dashboard 段）
const STATUS_KEY: Record<string, string> = {
  PENDING: 'statusPending',
  IN_PROGRESS: 'statusInProgress',
  READY: 'statusReady',
  COMPLETED: 'statusCompleted',
  CANCELLED: 'statusCancelled',
}

// 订单状态 → 徽章/色条样式（一眼可见的状态色彩编码，避免逐条读文字）
const STATUS_STYLE: Record<string, { badge: string; bar: string }> = {
  PENDING: {
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    bar: 'border-l-amber-400',
  },
  IN_PROGRESS: {
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    bar: 'border-l-blue-400',
  },
  READY: {
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    bar: 'border-l-green-400',
  },
  COMPLETED: {
    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    bar: 'border-l-zinc-300',
  },
  CANCELLED: {
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    bar: 'border-l-red-400',
  },
}

// 订单类型 → 徽章样式（外送用醒目 amber，提醒老板优先处理）
const ORDER_TYPE_STYLE: Record<string, { icon: string; key: string; badge: string }> = {
  dine_in: {
    icon: '🪑',
    key: 'orderTypeDineIn',
    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  },
  takeaway: {
    icon: '🛍️',
    key: 'orderTypeTakeaway',
    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  },
  delivery: {
    icon: '🛵',
    key: 'orderTypeDelivery',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
}

// 状态筛选 chips（全部 + 五个状态，复用 status 文案 key）
const FILTERS: { value: string; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'all' },
  { value: 'PENDING', labelKey: 'statusPending' },
  { value: 'IN_PROGRESS', labelKey: 'statusInProgress' },
  { value: 'READY', labelKey: 'statusReady' },
  { value: 'COMPLETED', labelKey: 'statusCompleted' },
  { value: 'CANCELLED', labelKey: 'statusCancelled' },
]

// 订单时间：dd/MM HH:mm（折叠行展示用）
function formatTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 订单列表：复制摘要 / 发 Zalo / 推进状态 / 取消 / 设置实收
export function OrderList({
  orders,
  shop,
}: {
  orders: OrderPlain[]
  shop: ShopPlain
}) {
  const t = useTranslations('dashboard')
  const ts = useTranslations('orderSummary')
  const router = useRouter()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [paidInput, setPaidInput] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [query, setQuery] = useState('')
  const { msg, show } = useToast()

  // 已完成订单默认折叠（仅显示订单号+价格+时间），点展开看全貌
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const isFolded = (order: OrderPlain) =>
    order.status === 'COMPLETED' && (collapsed[order.id] ?? true)

  // P1-1 新订单实时性：记当前最大 orderNo，轮询发现更大则刷新 + 提示音
  const maxRef = useRef(0)
  maxRef.current = orders.reduce(
    (m, o) => Math.max(m, o.orderNo),
    maxRef.current,
  )

  // 持久化 AudioContext：移动端 H5 需在用户手势后 resume 才能播提示音
  const audioCtxRef = useRef<AudioContext | null>(null)

  function unlockAudio() {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      void audioCtxRef.current.resume()
    } catch {
      // 不支持 Web Audio 时静默
    }
  }

  function playBeep() {
    try {
      unlockAudio()
      const ctx = audioCtxRef.current
      if (!ctx) return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.value = 0.15
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.25)
    } catch {
      // 音频不可用时静默，不影响刷新
    }
  }

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const latest = await getLatestOrderNo()
        if (latest > maxRef.current) {
          maxRef.current = latest
          playBeep()
          router.refresh()
        }
      } catch {
        // 轮询失败静默，下一轮重试
      }
    }, 20000)
    return () => clearInterval(id)
  }, [router])

  // 移动端 H5：首次触摸/点击解锁音频，之后轮询发现新单才能播提示音
  useEffect(() => {
    const unlock = () => unlockAudio()
    document.addEventListener('pointerdown', unlock, { once: true })
    document.addEventListener('touchstart', unlock, { once: true })
    return () => {
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('touchstart', unlock)
    }
  }, [])

  // 生成发给客户的订单摘要（三语模板 + items 拼接）
  function buildSummary(order: OrderPlain): string {
    const lines = [
      ts('header', { shopName: shop.name }),
      ts('orderNo', { orderNo: order.displayNo }),
      ...order.items.map((i) => {
        const detail = [
          ...(i.options ?? []).map((o) => o.name),
          ...(i.extras ?? []).map((e) => e.name),
        ].join(' · ')
        return `- ${i.name} x${i.qty}${detail ? ` (${detail})` : ''}`
      }),
      ...(order.note ? [`${ts('note')}: ${order.note}`] : []),
      ts('total', { total: formatPrice(Number(order.total)) }),
      ts('thanks'),
    ]
    return lines.join('\n')
  }

  async function copySummary(order: OrderPlain) {
    try {
      await navigator.clipboard.writeText(buildSummary(order))
      setCopiedId(order.id)
      show(t('toastCopied'))
      setTimeout(() => setCopiedId(null), 1500)
    } catch (e) {
      console.error('复制失败:', e)
      show(t('toastError'))
    }
  }

  // 唤起 Zalo 与客户聊天（半自动，0 API）
  function sendZalo(order: OrderPlain) {
    const phone = (order.customerPhone ?? shop.phone ?? '').replace(
      /[^0-9+]/g,
      '',
    )
    if (phone) {
      window.open(`https://zalo.me/${phone}`, '_blank')
      show(t('toastZaloSent'))
    } else {
      show(t('toastError'))
    }
  }

  // okMsg 传成功提示；失败统一走 toastError（P0-5）
  function run(fn: () => Promise<void>, okMsg?: string) {
    startTransition(async () => {
      try {
        await fn()
        if (okMsg) show(okMsg)
        router.refresh()
      } catch (e) {
        console.error('操作失败:', e)
        show(t('toastError'))
      }
    })
  }

  // 状态筛选 + 搜索（纯前端过滤，订单已全量加载，不改服务端查询）
  const q = query.trim().toLowerCase()
  const filtered = orders.filter((o) => {
    if (statusFilter !== 'ALL' && o.status !== statusFilter) return false
    if (q) {
      const hay = [
        o.displayNo,
        o.customerName ?? '',
        o.customerPhone ?? '',
        o.tableNo ?? '',
        o.note ?? '',
      ]
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  if (orders.length === 0) {
    return <p className="text-zinc-500">{t('empty')}</p>
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{t('title')}</h2>

      {/* 筛选工具栏：状态 chips + 搜索框 */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={
                statusFilter === f.value
                  ? 'rounded-full bg-amber-500 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </div>

      {filtered.length === 0 && <p className="text-zinc-500">{t('noMatch')}</p>}

      {filtered.map((order) => {
        const state = paymentState(order)
        const debt = Math.max(0, Number(order.total) - Number(order.paidAmount))
        const canAdvance = ['PENDING', 'IN_PROGRESS', 'READY'].includes(
          order.status,
        )
        const canCancel = !['COMPLETED', 'CANCELLED'].includes(order.status)
        const typeStyle = order.orderType
          ? ORDER_TYPE_STYLE[order.orderType]
          : undefined
        const typeLabel = typeStyle
          ? order.orderType === 'dine_in' && order.tableNo
            ? order.tableNo
            : t(typeStyle.key)
          : ''
        const folded = isFolded(order)
        if (folded) {
          return (
            <div
              key={order.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <button
                onClick={() =>
                  setCollapsed((prev) => ({ ...prev, [order.id]: false }))
                }
                className="flex items-center gap-2 text-left"
              >
                <span className="text-xs text-zinc-400">▸</span>
                <span className="font-medium">{order.displayNo}</span>
                <span className="text-xs text-zinc-400">
                  {formatTime(order.createdAt)}
                </span>
              </button>
              <span className="font-medium">
                {formatPrice(Number(order.total))}đ
              </span>
            </div>
          )
        }

        return (
          <div
            key={order.id}
            className={`rounded-xl border border-l-4 border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${STATUS_STYLE[order.status]?.bar ?? 'border-l-zinc-300'}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">{order.displayNo}</span>
                {order.status === 'COMPLETED' && (
                  <button
                    onClick={() =>
                      setCollapsed((prev) => ({ ...prev, [order.id]: true }))
                    }
                    aria-label="折叠"
                    className="text-xs text-zinc-400 hover:text-zinc-600"
                  >
                    ▾
                  </button>
                )}
                {typeStyle && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeStyle.badge}`}
                  >
                    {typeStyle.icon} {typeLabel}
                  </span>
                )}
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[order.status]?.badge ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
              >
                {t(STATUS_KEY[order.status] ?? 'statusPending')}
              </span>
            </div>

            {order.customerName || order.customerPhone ? (
              <p className="mb-1 text-sm text-zinc-600 dark:text-zinc-400">
                {order.customerName ?? ''}
                {order.customerName && order.customerPhone ? ' · ' : ''}
                {order.customerPhone ?? ''}
              </p>
            ) : null}

            <ul className="mb-2 text-sm">
              {order.items.map((item, idx) => (
                <li
                  key={idx}
                  className="flex justify-between text-zinc-600 dark:text-zinc-400"
                >
                  <span className="flex flex-col">
                    <span>{item.name} ×{item.qty}</span>
                    {((item.options?.length ?? 0) > 0 ||
                      (item.extras?.length ?? 0) > 0) && (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {[
                          ...(item.options ?? []).map((o) => o.name),
                          ...(item.extras ?? []).map((e) =>
                            Number(e.price) > 0
                              ? `${e.name} (+${formatPrice(Number(e.price))}đ)`
                              : e.name,
                          ),
                        ].join(' · ')}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {order.note && (
              <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
                {t('note')}: {order.note}
              </p>
            )}

            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-medium">
                {formatPrice(Number(order.total))}đ
              </span>
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
                {state !== 'paid'
                  ? ` · ${t('debt')} ${formatPrice(debt)}đ`
                  : ''}
              </span>
            </div>

            {/* 实收设置 + 收全款快捷 */}
            <div className="mb-3 flex items-center gap-2">
              <input
                type="number"
                value={paidInput[order.id] ?? order.paidAmount}
                onChange={(e) =>
                  setPaidInput((prev) => ({
                    ...prev,
                    [order.id]: e.target.value,
                  }))
                }
                placeholder={t('paidAmount')}
                className="w-28 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
              <button
                onClick={() =>
                  run(
                    () =>
                      setOrderPaidAmount(
                        order.id,
                        Number(paidInput[order.id] ?? order.paidAmount),
                      ),
                    t('toastPaid'),
                  )
                }
                disabled={pending}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t('save')}
              </button>
              <button
                onClick={() =>
                  run(
                    () => setOrderPaidAmount(order.id, Number(order.total)),
                    t('toastPaid'),
                  )
                }
                disabled={pending}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t('collectFull')}
              </button>
            </div>

            <div className="flex gap-2">
              {canAdvance && (
                <button
                  onClick={() =>
                    run(() => advanceOrderStatus(order.id), t('toastAdvanced'))
                  }
                  disabled={pending}
                  className="flex-1 rounded-md bg-amber-500 px-3 py-2 text-sm text-white transition-colors hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-500 dark:text-white"
                >
                  {t('advance')}
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => {
                    // P1-4 破坏性操作先确认（原生 confirm，简洁）
                    if (window.confirm(t('confirmCancel'))) {
                      run(() => cancelOrder(order.id))
                    }
                  }}
                  disabled={pending}
                  className="flex-1 rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                >
                  {t('cancelOrder')}
                </button>
              )}
              <button
                onClick={() => copySummary(order)}
                className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {copiedId === order.id ? '✓' : t('copySummary')}
              </button>
              <button
                onClick={() => sendZalo(order)}
                className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t('sendZalo')}
              </button>
            </div>
          </div>
        )
      })}
      <ToastView msg={msg} />
    </section>
  )
}
