'use client'

// 客户 track 查单页呼叫服务员（堂食店内等餐/加菜时找服务员，用户反馈）：
// 复用 callWaiter action（与菜单页同机制），创建 CALL_WAITER 提醒，老板端冒泡 + 声音
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { callWaiter } from '@/lib/shop-actions'

export function CallWaiterButton({
  slug,
  tableNo,
  phone,
}: {
  slug: string
  tableNo?: string
  phone?: string
}) {
  const t = useTranslations('track')
  const [sent, setSent] = useState(false)
  const [tooFrequent, setTooFrequent] = useState(false)
  // 第18批 冷却：呼叫成功后按钮禁用 60s（服务端同维度限流，客户端兜底防连点）
  const [cooldown, setCooldown] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleCall() {
    startTransition(async () => {
      try {
        await callWaiter({ slug, tableNo, phone })
        setSent(true)
        setCooldown(true)
        window.setTimeout(() => setSent(false), 3000)
        window.setTimeout(() => setCooldown(false), 60000)
      } catch (err) {
        // 频率限制：服务端抛 CALL_TOO_FREQUENT → 提示稍候；其他失败静默（不阻塞客户查看订单）
        const msg = err instanceof Error ? err.message : ''
        if (msg === 'CALL_TOO_FREQUENT') {
          setTooFrequent(true)
          window.setTimeout(() => setTooFrequent(false), 3000)
        }
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleCall}
        disabled={pending || cooldown}
        className="flex min-h-[52px] flex-1 items-center justify-center gap-1.5 rounded-[var(--theme-radius-btn)] border border-primary/40 px-3 text-lg text-primary-hover transition-colors hover:bg-primary/5 disabled:opacity-60"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {t('callWaiter')}
      </button>
      {sent && <span className="text-xs text-green-600 dark:text-green-400">{t('callWaiterSent')}</span>}
      {tooFrequent && (
        <span className="text-xs text-amber-600 dark:text-amber-400">{t('callTooFrequent')}</span>
      )}
    </div>
  )
}
