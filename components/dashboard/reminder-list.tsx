'use client'

import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { dismissReminder, markReminderSent } from '@/lib/actions'
import { formatPrice } from '@/lib/format'
import { useToast, ToastView } from './use-toast'

export type ReminderPlain = {
  id: string
  orderId: string | null
  templateKey: string
  displayNo: string
  customerPhone: string | null
  customerName: string | null
  tableNo: string | null
  total: string
  orderType: string | null
  // 关联订单状态（dashboard 查询 include 订单带出，用于过滤已取消单的待办）
  orderStatus: string | null
  // 订单下单时间 ISO：待办实时显示「下单多久」（第16批）
  orderCreatedAt: string | null
  items: { name: string; qty: number }[]
}

// 提醒模板 → 本地化 key（dashboard 段）
const TEMPLATE_KEY: Record<string, string> = {
  FOOD_NEW_ORDER: 'newOrder',
  FOOD_READY: 'ready',
  FOOD_REPURCHASE_21D: 'repurchase21d',
  CALL_WAITER: 'callWaiter',
  FOOD_ADD: 'addFood',
}

// 订单类型 → 本地化 key（复用订单列表的 orderTypeDineIn/Takeaway/Delivery）
const TYPE_KEY: Record<string, string> = {
  dine_in: 'orderTypeDineIn',
  takeaway: 'orderTypeTakeaway',
  delivery: 'orderTypeDelivery',
}

// 提醒模板 → 配色（新单 amber / 出餐完成 green / 复购 blue / 呼叫服务员 red）
const REMINDER_STYLE: Record<
  string,
  { border: string; bg: string; badge: string }
> = {
  FOOD_NEW_ORDER: {
    border: 'border-amber-200 dark:border-amber-800',
    bg: 'bg-amber-50 dark:bg-amber-950',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  FOOD_READY: {
    border: 'border-green-200 dark:border-green-800',
    bg: 'bg-green-50 dark:bg-green-950',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  },
  FOOD_REPURCHASE_21D: {
    border: 'border-blue-200 dark:border-blue-800',
    bg: 'bg-blue-50 dark:bg-blue-950',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  CALL_WAITER: {
    border: 'border-red-200 dark:border-red-800',
    bg: 'bg-red-50 dark:bg-red-950',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
  // 客户加菜待办：amber 系（同新单），保留到老板「去处理/忽略」或订单终态才清（不做 5s 自动消失）
  FOOD_ADD: {
    border: 'border-amber-200 dark:border-amber-800',
    bg: 'bg-amber-50 dark:bg-amber-950',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
}

// 订单类型 → 整卡配色（用户反馈：待办用颜色区分订单类型——堂食蓝 / 外带绿 / 外送紫 / 兜底橙）
const ORDER_TYPE_STYLE: Record<string, { border: string; bg: string; badge: string }> = {
  dine_in: {
    border: 'border-blue-200 dark:border-blue-800',
    bg: 'bg-blue-50 dark:bg-blue-950',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  takeaway: {
    border: 'border-green-200 dark:border-green-800',
    bg: 'bg-green-50 dark:bg-green-950',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  },
  delivery: {
    border: 'border-purple-200 dark:border-purple-800',
    bg: 'bg-purple-50 dark:bg-purple-950',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  },
  other: {
    border: 'border-amber-200 dark:border-amber-800',
    bg: 'bg-amber-50 dark:bg-amber-950',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
}

// 待办提醒：新单冒泡 / 完成通知 / 复购提醒（一键复制发 Zalo，0 API）
export function ReminderList({
  reminders,
  shopName,
  currency,
}: {
  reminders: ReminderPlain[]
  shopName: string
  currency: string
}) {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const { msg, show } = useToast()
  // 待办提醒可折叠：默认展开，点击标题收起，避免挤占订单区
  const [collapsed, setCollapsed] = useState(false)
  // 实时「下单多久」：每 30s tick 刷新，避免只显示服务端渲染的静态时刻（第16批）
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  function buildText(r: ReminderPlain): string {
    return [
      `${shopName}`,
      t(TEMPLATE_KEY[r.templateKey] ?? 'newOrder'),
      r.displayNo,
      r.customerName ?? '',
      r.total ? `${t('total')}: ${formatPrice(Number(r.total), currency)}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  // 相对时间：订单下单至今（<1min「刚刚」/<1h 分钟/<24h 小时/≥1d 天），now 由 30s tick 提供（实时刷新）
  function elapsedText(iso: string | null): string {
    if (!iso) return ''
    const diff = now - new Date(iso).getTime()
    if (diff < 60 * 1000) return t('justNow')
    if (diff < 60 * 60 * 1000) return t('minsAgo', { n: Math.floor(diff / 60000) })
    if (diff < 24 * 60 * 60 * 1000) return t('hoursAgo', { n: Math.floor(diff / 3600000) })
    return t('daysAgo', { n: Math.floor(diff / 86400000) })
  }

  function handleSendZalo(r: ReminderPlain) {
    navigator.clipboard.writeText(buildText(r)).catch((e) => {
      console.error('复制失败:', e)
    })
    const phone = (r.customerPhone ?? '').replace(/[^0-9+]/g, '')
    if (phone) {
      window.open(`https://zalo.me/${phone}`, '_blank')
      show(t('toastZaloSent'))
    } else {
      // 无手机号单：摘要已复制成功，不算失败（不再弹「操作失败」误导）
      show(t('toastCopied'))
    }
    startTransition(async () => {
      await markReminderSent(r.id)
      router.refresh()
    })
  }

  function handleDismiss(id: string) {
    startTransition(async () => {
      await dismissReminder(id)
      router.refresh()
    })
  }

  // 点击待办 → 滚动到对应订单卡片并高亮闪烁（免去主动翻单）
  function jumpToOrder(orderId: string | null) {
    if (!orderId) return
    const el = document.getElementById(`order-${orderId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.9)'
    el.style.transition = 'box-shadow 0.3s ease'
    window.setTimeout(() => {
      el.style.boxShadow = ''
    }, 2500)
    // 通知 OrderList 自动展开该订单（跨组件，用自定义事件，避免提升 state）
    window.dispatchEvent(new CustomEvent('order-jump', { detail: { orderId } }))
  }

  // 呼叫服务员是店内即时事件，10 秒后自动消失（用户反馈：5 秒太短，看不到提示）
  useEffect(() => {
    const callIds = reminders
      .filter((r) => r.templateKey === 'CALL_WAITER')
      .map((r) => r.id)
    if (callIds.length === 0) return
    const timers = callIds.map((id) =>
      setTimeout(() => {
        startTransition(async () => {
          await dismissReminder(id)
          router.refresh()
        })
      }, 10000),
    )
    return () => timers.forEach(clearTimeout)
    // reminders 变化时重建计时器；startTransition/router 稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders])

  // 已取消订单的待办无意义：过滤（查询端已过滤，组件内兜底防御）
  const activeReminders = reminders.filter((r) => r.orderStatus !== 'CANCELLED')
  if (activeReminders.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      {/* 待办提醒折叠头：点击收起/展开，不挤占订单列表 */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      >
        <h2 className="text-lg font-medium">{t('reminders')}</h2>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
          {activeReminders.length}
        </span>
        <span className="ml-auto text-zinc-400">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed &&
        activeReminders.map((r) => {
        // 整卡配色按订单类型（一眼区分堂食/外带/外送），模板徽章保留原模板色
        const typeStyle = ORDER_TYPE_STYLE[r.orderType ?? 'other'] ?? ORDER_TYPE_STYLE.other
        const badgeStyle = REMINDER_STYLE[r.templateKey] ?? REMINDER_STYLE.FOOD_NEW_ORDER
        const itemsText = (r.items ?? []).map((i) => `${i.name} ×${i.qty}`).join('  ·  ')
        const typeLabel = r.orderType ? t(TYPE_KEY[r.orderType] ?? 'orderTypeDineIn') : ''
        // 一行跑马灯：桌号 + 客户 + 单号 + 菜品 + Zalo 手机号滚动展示（原设计「一行展示全部要点」）
        const phone = (r.customerPhone ?? '').replace(/[^0-9+]/g, '')
        const marqueeText = [
          r.tableNo ? `${t('tableNo')} ${r.tableNo}` : '',
          r.customerName ?? '',
          r.displayNo,
          itemsText,
          phone ? `Zalo ${phone}` : '',
        ]
          .filter(Boolean)
          .join('  ·  ')
        // 一行宽度有限，内容略长即滚动（短文本静态显示，避免无意义滚动）
        const needMarquee = marqueeText.length > 20
        return (
          <div
            key={r.id}
            className={`rounded-xl border p-4 shadow-sm ${typeStyle.border} ${typeStyle.bg}`}
          >
            <div className="flex items-center gap-3">
              {/* 左侧主体：类型徽章 + 一行跑马灯（桌号/客户/单号/菜品/zalo），点击跳单 */}
              <div
                onClick={() => jumpToOrder(r.orderId)}
                className={`min-w-0 flex-1 ${r.orderId ? 'cursor-pointer' : ''}`}
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeStyle.badge}`}
                  >
                    {t(TEMPLATE_KEY[r.templateKey] ?? 'newOrder')}
                  </span>
                  {typeLabel && (
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {typeLabel}
                    </span>
                  )}
                  {/* 桌号固定显示到类型徽章同一行（用户反馈：桌号也显示到这一行，一眼可读） */}
                  {r.tableNo && (
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {t('tableNo')} {r.tableNo}
                    </span>
                  )}
                  {/* 下单多久：实时刷新（30s tick），与订单类型同一行（用户反馈） */}
                  {elapsedText(r.orderCreatedAt) && (
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {elapsedText(r.orderCreatedAt)}
                    </span>
                  )}
                </div>
                <div className="overflow-hidden whitespace-nowrap text-sm text-zinc-600 dark:text-zinc-300">
                  {needMarquee ? (
                    <span className="inline-block animate-marquee will-change-transform">
                      {marqueeText}  ·  {marqueeText}
                    </span>
                  ) : (
                    <span className="block truncate">{marqueeText}</span>
                  )}
                </div>
              </div>

              {/* 右侧按钮区（标准尺寸）：发 Zalo（非呼叫服务员）+ 忽略 */}
              <div className="flex shrink-0 flex-col gap-1.5">
                {r.templateKey !== 'CALL_WAITER' && (
                  <button
                    onClick={() => handleSendZalo(r)}
                    disabled={pending}
                    className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
                  >
                    {t('sendZalo')}
                  </button>
                )}
                <button
                  onClick={() => handleDismiss(r.id)}
                  disabled={pending}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {t('dismiss')}
                </button>
              </div>
            </div>
          </div>
        )
      })}
      <ToastView msg={msg} />
    </section>
  )
}
