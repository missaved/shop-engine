'use client'
// M3 保养提醒待办：MOTO_SERVICE_DUE（picked_up 交接时生成，见 lib/moto-actions）
// 展示到点冒泡 + 一键复制文案 + Zalo 深链 + 忽略（复用 food 的 dismissReminder / useToast）
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getMotoReminders } from '@/lib/moto-actions'
import { dismissReminder } from '@/lib/actions'
import { useToast, ToastView } from '../dashboard/use-toast'

type MotoReminder = {
  id: string
  orderId: string | null
  plate: string
  brand: string | null
  model: string | null
  ownerName: string | null
  ownerPhone: string | null
  nextServiceKm: string | null
  nextServiceDue: string | null
}

export function MotoReminderList({ shopName }: { shopName: string }) {
  const t = useTranslations('moto')
  const { msg, show } = useToast()
  const [items, setItems] = useState<MotoReminder[]>([])

  const load = useCallback(async () => {
    try {
      setItems(await getMotoReminders())
    } catch {
      /* 忽略刷新失败 */
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000) // 30s 轮询（到点自动冒泡）
    return () => clearInterval(timer)
  }, [load])

  // 一键复制文案：店名 + 车牌车型 + 下次保养（里程/日期）
  const buildText = (r: MotoReminder) => {
    const model = r.brand && r.model ? `${r.brand} ${r.model}` : r.brand || r.model || ''
    const km = r.nextServiceKm ? `${Number(r.nextServiceKm).toLocaleString('vi-VN')}km` : ''
    const due = r.nextServiceDue
      ? new Date(r.nextServiceDue).toLocaleDateString('vi-VN')
      : ''
    return [
      shopName,
      t('remindText', { plate: r.plate, model }),
      km ? t('remindKm', { km }) : '',
      due ? t('remindDue', { date: due }) : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  // 复制兼容：优先 navigator.clipboard（https 安全上下文），http 降级 execCommand（测试/局域网部署）
  const copyText = (text: string) => {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => {
        copyFallback(text)
      })
    }
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

  // 发 Zalo：复制文案 + 打开 zalo.me 深链 + 标记已处理（0 API）
  const send = (r: MotoReminder) => {
    copyText(buildText(r))
    const phone = (r.ownerPhone ?? '').replace(/[^0-9+]/g, '')
    if (phone) {
      window.open(`https://zalo.me/${phone}`, '_blank')
      show(t('toastZaloSent'))
    } else {
      show(t('toastCopied'))
    }
    dismissReminder(r.id).catch(() => {})
  }

  const dismiss = (r: MotoReminder) => dismissReminder(r.id).catch(() => {})

  if (items.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">
          {t('reminders')}
        </h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          {items.length}
        </span>
      </div>
      {items.map((r) => (
        <div
          key={r.id}
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-800 dark:bg-amber-950"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-wider">{r.plate}</span>
                {(r.brand || r.model) && (
                  <span className="truncate text-sm text-zinc-500">
                    {r.brand} {r.model}
                  </span>
                )}
              </div>
              {r.ownerName && <div className="mt-0.5 text-sm text-zinc-500">{r.ownerName}</div>}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                {r.nextServiceKm != null && (
                  <span>
                    {t('nextService')}: {Number(r.nextServiceKm).toLocaleString('vi-VN')}km
                  </span>
                )}
                {r.nextServiceDue && (
                  <span className="text-zinc-500">
                    {new Date(r.nextServiceDue).toLocaleDateString('vi-VN')}
                  </span>
                )}
              </div>
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
