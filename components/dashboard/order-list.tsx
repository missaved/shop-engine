'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import type { ShopTheme } from '@/lib/theme'
import {
  addItemsToOrder,
  advanceOrderStatus,
  cancelOrder,
  getLatestOrderNo,
  getLatestCallTs,
  removeItemFromOrder,
  setOrderPaidAmount,
} from '@/lib/actions'
import { useToast, ToastView } from './use-toast'
import { formatPrice } from '@/lib/format'
import { playVoice, preloadVoices } from '@/lib/audio'

// 订单与店铺的序列化类型（server component 已把 Decimal/Date 转成基础类型）
export type OrderItem = {
  name: string
  qty: number
  price: number | string
  extras?: { name: string; price: number | string }[]
  options?: { group: string; name: string; price: number | string }[]
  combo?: { name: string; qty: number }[]
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
  address: string | null
  createdAt: string
  // 是否为业务日「今天」（服务端按 UTC+7 计算，见 dashboard/page.tsx）
  today: boolean
  items: OrderItem[]
}
export type ShopPlain = {
  id: string
  slug: string
  name: string
  phone: string | null
  open: boolean
  currency: string
  config: {
    openHours?: string
    minOrderAmount?: number
    deliveryFee?: number
    packingFee?: number
    deliveryArea?: string
    description?: string
    descriptionZh?: string // 店面介绍·中文（2026-08-29 语种混杂修复）
    descriptionEn?: string // 店面介绍·英文
    theme?: ShopTheme
  } | null
}
// 加菜面板可选商品（id/name/price/active 够用，ProductPlain 满足此结构）
export type AddableProduct = {
  id: string
  name: string
  price: string
  active: boolean
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

// 堂食店内用餐：READY 显示「已上桌」而非「待取」；外带/外送维持「待取」
function statusKeyOf(o: OrderPlain): string {
  if (o.status === 'READY' && o.orderType === 'dine_in') return 'statusReadyDineIn'
  return STATUS_KEY[o.status] ?? 'statusPending'
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
const ORDER_TYPE_STYLE: Record<string, { key: string; badge: string }> = {
  dine_in: {
    key: 'orderTypeDineIn',
    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  },
  takeaway: {
    key: 'orderTypeTakeaway',
    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  },
  delivery: {
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
  products,
}: {
  orders: OrderPlain[]
  shop: ShopPlain
  products: AddableProduct[]
}) {
  const t = useTranslations('dashboard')
  const ts = useTranslations('orderSummary')
  const router = useRouter()
  const locale = useLocale()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [paidInput, setPaidInput] = useState<Record<string, string>>({})
  // 支付方式（现金/扫码/其他），按订单存，默认现金
  const [paymentMethod, setPaymentMethod] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [query, setQuery] = useState('')
  // 加菜面板状态（一次只展开一个订单；商品/数量全局共享，展开时重置）
  const [addOpenId, setAddOpenId] = useState<string | null>(null)
  const [addProductId, setAddProductId] = useState('')
  const [addQty, setAddQty] = useState('1')
  const { msg, show } = useToast()

  // 所有订单默认折叠成概要行（仅订单号+状态+时间+金额），点开看全貌（含 PENDING/READY）
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const isFolded = (order: OrderPlain) => collapsed[order.id] ?? true
  // 展开后 5 秒自动收回（所有订单统一规则，含进行中）；timer 按订单 id 独立，点开 A 再点 B 互不影响、各自按时收回
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
      }, 5000)
    )
  }, [])
  function expandOrder(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: false }))
    scheduleAutoCollapse(id)
  }

  // 待办提醒点击跳单：监听 order-jump 事件（由 ReminderList 派发），收到即展开该订单 + 5 秒自动收回（与手动展开同规则）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ orderId?: string }>).detail
      if (!detail?.orderId) return
      // 已取消订单不展开（终态默认折叠，跳单无意义）
      const target = orders.find((o) => o.id === detail.orderId)
      if (!target || target.status === 'CANCELLED') return
      setCollapsed((prev) => ({ ...prev, [detail.orderId!]: false }))
      scheduleAutoCollapse(detail.orderId!)
    }
    window.addEventListener('order-jump', handler)
    return () => window.removeEventListener('order-jump', handler)
  }, [orders, scheduleAutoCollapse])

  // 组件卸载时清空所有自动收回计时器（防泄漏）
  useEffect(() => {
    const timers = collapseTimersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  // P1-1 新订单实时性：记当前最大 orderNo，轮询发现更大则刷新 + 提示音
  const maxRef = useRef(0)
  maxRef.current = orders.reduce(
    (m, o) => Math.max(m, o.orderNo),
    maxRef.current,
  )
  // 呼叫服务员实时性：记最新 CALL_WAITER 提醒时间戳（轮询发现变化则刷新 + 提示音）
  const callTsRef = useRef(0)

  useEffect(() => {
    let firstCall = true // 首次轮询只初始化 callTsRef，避免误报历史呼叫
    const id = setInterval(async () => {
      try {
        const latest = await getLatestOrderNo()
        if (latest > maxRef.current) {
          maxRef.current = latest
          void playVoice(`/sounds/new-order.${locale}.mp3`)
          show(t('newOrderAlert'))
          router.refresh()
        }
        const latestCall = await getLatestCallTs()
        if (firstCall) {
          callTsRef.current = latestCall
          firstCall = false
        } else if (latestCall > callTsRef.current) {
          callTsRef.current = latestCall
          void playVoice(`/sounds/call-waiter.${locale}.mp3`)
          show(t('callWaiterAlert'))
          router.refresh()
        }
      } catch {
        // 轮询失败静默，下一轮重试
      }
    }, 2000)
    return () => clearInterval(id)
  }, [router, show, t, locale])

  // 预加载全部三语提示语音，播放时零延迟（首次 fetch+decode 的延迟被前置）
  useEffect(() => {
    const urls: string[] = []
    for (const loc of routing.locales) {
      urls.push(`/sounds/new-order.${loc}.mp3`, `/sounds/call-waiter.${loc}.mp3`)
    }
    void preloadVoices(urls)
  }, [])

  // 屏幕常亮（Wake Lock）：老板端挂机收单时防熄屏；不支持的浏览器/非 secure 上下文静默降级
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: {
        request: (type: string) => Promise<{ release: () => Promise<void> }>
      }
    }
    let sentinel: { release: () => Promise<void> } | null = null
    const request = async () => {
      try {
        sentinel = (await nav.wakeLock?.request('screen')) ?? null
      } catch {
        // 不支持或权限拒绝时静默
      }
    }
    void request()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release()
    }
  }, [])

  // 生成发给客户的订单摘要（三语模板 + items 拼接）
  function buildSummary(order: OrderPlain): string {
    const lines = [
      ts('header', { shopName: shop.name }),
      ts('orderNo', { orderNo: order.displayNo }),
      ...order.items.map((i) => {
        const comboStr = (i.combo ?? [])
          .map((c) => (c.qty > 1 ? `${c.name}×${c.qty}` : c.name))
          .join(', ')
        const detail = [
          comboStr,
          ...(i.options ?? []).map((o) => o.name),
          ...(i.extras ?? []).map((e) => e.name),
        ].filter(Boolean).join(' · ')
        return `- ${i.name} x${i.qty}${detail ? ` (${detail})` : ''}`
      }),
      ...(order.note ? [`${ts('note')}: ${order.note}`] : []),
      ts('total', { total: formatPrice(Number(order.total), shop.currency) }),
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
        // 推进到完毕但未收款：给明确的业务提示，其余用通用失败提示
        show(e instanceof Error && e.message === 'PAY_FIRST' ? t('payFirst') : t('toastError'))
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

  // 订单管理显示规则（2026-08-29 用户反馈）：进行中订单（未处理/未收款）无论是否今日都常显——
  // 未走完完整流程的订单不能隐藏；只有终态订单（COMPLETED/CANCELLED）的历史部分才按 Issue6「只显示今日」隐藏
  const todayList = filtered.filter(
    (o) => o.today || ['PENDING', 'IN_PROGRESS', 'READY'].includes(o.status),
  )

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

      {todayList.length === 0 && <p className="text-zinc-500">{t('noMatch')}</p>}

      {todayList.map((order) => {
        const state = paymentState(order)
        const debt = Math.max(0, Number(order.total) - Number(order.paidAmount))
        // 推进到已上桌/待取（READY）后可推进；READY 之后只收钱，不再显示推进按钮
        const canAdvance = ['PENDING', 'IN_PROGRESS'].includes(order.status)
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
              id={`order-${order.id}`}
              onClick={() => expandOrder(order.id)}
              className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2 text-left">
                <span className="text-xs text-zinc-400">▸</span>
                <span className="font-medium">{order.displayNo}</span>
                {order.status && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[order.status]?.badge ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
                  >
                    {t(statusKeyOf(order))}
                  </span>
                )}
                <span className="text-xs text-zinc-400">
                  {formatTime(order.createdAt)}
                </span>
              </div>
              <span className="font-medium">
                {formatPrice(Number(order.total), shop.currency)}
              </span>
            </div>
          )
        }

        return (
          <div
            key={order.id}
            id={`order-${order.id}`}
            className={`rounded-xl border border-l-4 border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${STATUS_STYLE[order.status]?.bar ?? 'border-l-zinc-300'}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">{order.displayNo}</span>
                <button
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [order.id]: true }))
                  }
                  aria-label={t('fold')}
                  className="text-xs text-zinc-400 hover:text-zinc-600"
                >
                  ▾
                </button>
                {typeStyle && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeStyle.badge}`}
                  >
                    {typeLabel}
                  </span>
                )}
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[order.status]?.badge ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
              >
                {t(statusKeyOf(order))}
              </span>
            </div>

            {order.customerName || order.customerPhone ? (
              <p className="mb-1 text-sm text-zinc-600 dark:text-zinc-400">
                {order.customerName ?? ''}
                {order.customerName && order.customerPhone ? ' · ' : ''}
                {order.customerPhone ?? ''}
              </p>
            ) : null}

            {order.orderType === 'delivery' && order.address ? (
              <p className="mb-1 text-sm text-zinc-600 dark:text-zinc-400">
                {t('address')}: {order.address}
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
                      (item.extras?.length ?? 0) > 0 ||
                      (item.combo?.length ?? 0) > 0) && (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {[
                          ...(item.combo ?? []).map((c) =>
                            c.qty > 1 ? `${c.name}×${c.qty}` : c.name,
                          ),
                          ...(item.options ?? []).map((o) => o.name),
                          ...(item.extras ?? []).map((e) =>
                            Number(e.price) > 0
                              ? `${e.name} (+${formatPrice(Number(e.price), shop.currency)})`
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
                {formatPrice(Number(order.total), shop.currency)}
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
                  ? ` · ${t('debt')} ${formatPrice(debt, shop.currency)}`
                  : ''}
              </span>
            </div>

            {/* 收款：支付方式 3 选 + 实收金额 + 快捷收全款（终态订单已结/已取消，不可改实收，不渲染） */}
            {!['COMPLETED', 'CANCELLED'].includes(order.status) && (
              <div className="mb-3">
                <div className="mb-2 flex gap-2">
                  {(['cash', 'qr', 'other'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        setPaymentMethod((prev) => ({ ...prev, [order.id]: m }))
                      }
                      className={`flex-1 rounded-md border px-2.5 text-xs transition-colors min-h-[40px] ${
                        (paymentMethod[order.id] ?? 'cash') === m
                          ? 'border-amber-500 bg-amber-500 text-white'
                          : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {t(m === 'cash' ? 'payCash' : m === 'qr' ? 'payQr' : 'payOther')}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
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
                            (paymentMethod[order.id] as
                              | 'cash'
                              | 'qr'
                              | 'other'
                              | undefined) ?? 'cash',
                          ),
                        t('toastPaid'),
                      )
                    }
                    disabled={pending}
                    className="rounded-md border border-zinc-300 px-3 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 min-h-[44px]"
                  >
                    {t('collect')}
                  </button>
                  <button
                    onClick={() =>
                      run(
                        () =>
                          setOrderPaidAmount(
                            order.id,
                            Number(order.total),
                            (paymentMethod[order.id] as
                              | 'cash'
                              | 'qr'
                              | 'other'
                              | undefined) ?? 'cash',
                          ),
                        t('toastPaid'),
                      )
                    }
                    disabled={pending}
                    className="rounded-md border border-zinc-300 px-3 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 min-h-[44px]"
                  >
                    {t('collectFull')}
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {canAdvance && (
                <button
                  onClick={() =>
                    run(
                      () => advanceOrderStatus(order.id),
                      t('toastAdvanced'),
                    )
                  }
                  disabled={pending}
                  className="flex-1 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-4 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60 min-h-[44px]"
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
                  className="flex-1 rounded-md border border-red-300 px-3 text-sm text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950 min-h-[44px]"
                >
                  {t('cancelOrder')}
                </button>
              )}
              {!['COMPLETED', 'CANCELLED'].includes(order.status) && (
                <button
                  onClick={() => {
                    setAddOpenId(addOpenId === order.id ? null : order.id)
                    setAddProductId('')
                    setAddQty('1')
                  }}
                  className="flex-1 rounded-md border border-amber-300 px-3 text-sm text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950 min-h-[44px]"
                >
                  {addOpenId === order.id ? '×' : t('addItem')}
                </button>
              )}
              <button
                onClick={() => copySummary(order)}
                className="flex-1 rounded-md border border-zinc-300 px-3 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 min-h-[44px]"
              >
                {copiedId === order.id ? '✓' : t('copySummary')}
              </button>
              <button
                onClick={() => sendZalo(order)}
                className="flex-1 rounded-md border border-zinc-300 px-3 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 min-h-[44px]"
              >
                {t('sendZalo')}
              </button>
            </div>

            {/* 第 3 批-12 加菜面板：当前商品（可删）+ 选商品加菜 */}
            {addOpenId === order.id && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-3 dark:border-amber-700 dark:bg-amber-950/20">
                <div className="text-xs font-semibold text-zinc-500">
                  {t('items')}
                </div>
                {order.items.length === 0 && (
                  <p className="text-xs text-zinc-400">{t('empty')}</p>
                )}
                {order.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {item.name} ×{item.qty}
                      {(item.combo?.length ?? 0) > 0 && (
                        <span className="ml-1 text-xs text-zinc-400">
                          {(item.combo ?? [])
                            .map((c) => (c.qty > 1 ? `${c.name}×${c.qty}` : c.name))
                            .join(', ')}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() =>
                        run(
                          () =>
                            removeItemFromOrder({
                              orderId: order.id,
                              index: idx,
                            }),
                          t('toastUpdated'),
                        )
                      }
                      disabled={pending}
                      className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      {t('removeItem')}
                    </button>
                  </div>
                ))}
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={addProductId}
                    onChange={(e) => setAddProductId(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  >
                    <option value="">{t('addItem')}…</option>
                    {products
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {formatPrice(Number(p.price), shop.currency)}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={addQty}
                    onChange={(e) => setAddQty(e.target.value)}
                    className="w-16 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  />
                  <button
                    onClick={() => {
                      if (!addProductId) return
                      run(
                        () =>
                          addItemsToOrder({
                            orderId: order.id,
                            items: [
                              {
                                productId: addProductId,
                                qty: Number(addQty) || 1,
                              },
                            ],
                          }),
                        t('toastUpdated'),
                      )
                    }}
                    disabled={pending || !addProductId}
                    className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
                  >
                    {t('add')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <ToastView msg={msg} />
    </section>
  )
}
