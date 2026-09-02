'use client'
// 待取催取提醒：LAUNDRY_READY（推进到「待取」时生成）+ 逾期分级（>3d/>7d 文案更急）
// 一键复制文案 + Zalo 深链 + 忽略（复用 moto 半自动模式，0 API）
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getLaundryReminders, markLaundryReminderSent, dismissLaundryReminder } from '@/lib/laundry-actions'
import { useToast, ToastView } from '../dashboard/use-toast'

type Item = { id: string; overdueClass: 0 | 1 | 2; displayNo: string | null; tagCode: string | null; customerPhone: string | null; total: string }

export function LaundryReminderList({ shopName }: { shopName: string }) {
  const t = useTranslations('laundry')
  const { msg, show } = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [collapsed, setCollapsed] = useState(true)

  const load = useCallback(async () => {
    try {
      setItems(await getLaundryReminders())
    } catch {
      /* 忽略 */
    }
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load])

  const buildText = (r: Item) => {
    const tag = r.tagCode ? `(${r.tagCode})` : ''
    const line = r.overdueClass > 0 ? t('overdueRemindText', { tag }) : t('readyRemindText', { tag })
    return [shopName, line].filter(Boolean).join('\n\n')
  }

  const copyText = (text: string) => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => copyFallback(text))
    return copyFallback(text)
  }
  const copyFallback = (text: string) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }

  const send = (r: Item) => {
    copyText(buildText(r))
    const phone = (r.customerPhone ?? '').replace(/[^0-9+]/g, '')
    if (phone) {
      window.open(`https://zalo.me/${phone}`, '_blank')
      show(t('toastZaloSent'))
    } else {
      show(t('toastCopied'))
    }
    markLaundryReminderSent(r.id).catch(() => {})
  }

  const dismiss = (r: Item) => dismissLaundryReminder(r.id).catch(() => {})

  if (items.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <button onClick={() => setCollapsed((c) => !c)} className="flex w-full items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{t('reminders')}</h2>
        <span className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{items.length}</span>
          <span className="text-xs">{collapsed ? '▸' : '▾'}</span>
        </span>
      </button>
      {!collapsed && items.map((r) => (
        <div
          key={r.id}
          className={`rounded-xl border p-4 shadow-sm dark:border-amber-800 dark:bg-amber-950 ${
            r.overdueClass > 0 ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">{r.tagCode}</span>
                {r.displayNo && <span className="text-sm text-zinc-500">{r.displayNo}</span>}
              </div>
              {r.overdueClass > 0 && (
                <div className="mt-1 text-sm font-medium text-red-600">
                  {r.overdueClass === 2 ? t('overdue2') : t('overdue1')}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <button
                onClick={() => send(r)}
                className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98]"
              >
                {t('sendZalo')}
              </button>
              <button
                onClick={() => dismiss(r)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t('dismiss')}
              </button>
            </div>
          </div>
        </div>
      ))}
      <ToastView msg={msg} />
    </section>
  )
}
