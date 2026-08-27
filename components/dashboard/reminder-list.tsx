'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { dismissReminder, markReminderSent } from '@/lib/actions'
import { useToast, ToastView } from './use-toast'

export type ReminderPlain = {
  id: string
  templateKey: string
  displayNo: string
  customerPhone: string | null
  customerName: string | null
  tableNo: string | null
  total: string
}

// 提醒模板 → 本地化 key（dashboard 段）
const TEMPLATE_KEY: Record<string, string> = {
  FOOD_NEW_ORDER: 'newOrder',
  FOOD_READY: 'ready',
  FOOD_REPURCHASE_21D: 'repurchase21d',
  CALL_WAITER: 'callWaiter',
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
      `🏪 ${shopName}`,
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

  if (reminders.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{t('reminders')}</h2>
      {reminders.map((r) => {
        const style = REMINDER_STYLE[r.templateKey] ?? REMINDER_STYLE.FOOD_NEW_ORDER
        return (
          <div
            key={r.id}
            className={`flex items-center justify-between rounded-xl border p-3 shadow-sm ${style.border} ${style.bg}`}
          >
            <div className="flex flex-col">
              <span
                className={`self-start rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}
              >
                {t(TEMPLATE_KEY[r.templateKey] ?? 'newOrder')}
              </span>
              <span className="mt-1 text-xs text-zinc-500">
                {r.tableNo ? `🪑 ${r.tableNo}` : r.displayNo}
                {r.customerName ? ` · ${r.customerName}` : ''}
              </span>
            </div>
            <div className="flex gap-2">
              {/* 呼叫服务员无需发 Zalo（顾客在店内，只需处理/忽略） */}
              {r.templateKey !== 'CALL_WAITER' && (
                <button
                  onClick={() => handleSendZalo(r)}
                  disabled={pending}
                  className="rounded-md bg-amber-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-500 dark:text-white"
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
