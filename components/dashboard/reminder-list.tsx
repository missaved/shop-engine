'use client'

import { useEffect, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { dismissReminder, markReminderSent } from '@/lib/actions'
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
  items: { name: string; qty: number }[]
}

// 提醒模板 → 本地化 key（dashboard 段）
const TEMPLATE_KEY: Record<string, string> = {
  FOOD_NEW_ORDER: 'newOrder',
  FOOD_READY: 'ready',
  FOOD_REPURCHASE_21D: 'repurchase21d',
  CALL_WAITER: 'callWaiter',
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
}

// 待办提醒：新单冒泡 / 完成通知 / 复购提醒（一键复制发 Zalo，0 API）
export function ReminderList({
  reminders,
  shopName,
}: {
  reminders: ReminderPlain[]
  shopName: string
}) {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const { msg, show } = useToast()

  function buildText(r: ReminderPlain): string {
    return [
      `${shopName}`,
      t(TEMPLATE_KEY[r.templateKey] ?? 'newOrder'),
      r.displayNo,
      r.customerName ?? '',
      r.total ? `${t('total')}: ${Number(r.total).toLocaleString('vi-VN')}đ` : '',
    ]
      .filter(Boolean)
      .join('\n')
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
      show(t('toastError'))
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
  }

  // 呼叫服务员是店内即时事件，5 秒后自动消失（不一直卡在待办里影响体验）
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
      }, 5000),
    )
    return () => timers.forEach(clearTimeout)
    // reminders 变化时重建计时器；startTransition/router 稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders])

  if (reminders.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{t('reminders')}</h2>
      {reminders.map((r) => {
        const style = REMINDER_STYLE[r.templateKey] ?? REMINDER_STYLE.FOOD_NEW_ORDER
        const itemsText = (r.items ?? []).map((i) => `${i.name} ×${i.qty}`).join('  ·  ')
        const typeLabel = r.orderType ? t(TYPE_KEY[r.orderType] ?? 'orderTypeDineIn') : ''
        // 菜品过长才跑马灯（短文本静态显示，避免无意义滚动）
        const needMarquee = itemsText.length > 28
        return (
          <div
            key={r.id}
            className={`rounded-xl border p-3 shadow-sm ${style.border} ${style.bg}`}
          >
            {/* 主体：点击跳单（仅新单有 orderId，按钮区在其下独立） */}
            <div
              onClick={() => jumpToOrder(r.orderId)}
              className={r.orderId ? 'cursor-pointer' : ''}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}
                  >
                    {t(TEMPLATE_KEY[r.templateKey] ?? 'newOrder')}
                  </span>
                  {typeLabel && (
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {typeLabel}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-xs font-medium text-zinc-500">
                  {r.displayNo}
                </span>
              </div>

              <div className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                {r.tableNo ? `${t('tableNo')} ${r.tableNo}` : ''}
                {r.tableNo && r.customerName ? ' · ' : ''}
                {r.customerName ?? ''}
              </div>

              {itemsText &&
                (needMarquee ? (
                  <div className="mt-1.5 overflow-hidden whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="inline-block animate-marquee will-change-transform">
                      {itemsText}  ·  {itemsText}
                    </span>
                  </div>
                ) : (
                  <div className="mt-1.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {itemsText}
                  </div>
                ))}
            </div>

            <div className="mt-2 flex justify-end gap-2">
              {/* 呼叫服务员无需发 Zalo（顾客在店内，只需处理/忽略） */}
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
        )
      })}
      <ToastView msg={msg} />
    </section>
  )
}
