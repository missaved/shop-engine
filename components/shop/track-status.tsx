'use client'

// 查单页实时状态：5s 轮询订单状态（2026-08-30 由 15s 缩短），出餐(READY)时语音 + 横幅即时提示；
// 任意状态变化（含结账/取消）触发整页刷新，让状态标签/进度条/加菜区/继续点菜按钮自动对齐服务端
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getTrackStatus } from '@/lib/actions'
import { useRouter } from '@/i18n/navigation'

export function TrackStatus({
  slug,
  orderNo,
  phone,
  guestKey,
  byIp,
  initialStatus,
  orderType,
}: {
  slug: string
  orderNo: string
  phone: string
  guestKey?: string
  byIp?: boolean
  initialStatus: string
  orderType?: string
}) {
  const t = useTranslations('track')
  const router = useRouter()
  const [ready, setReady] = useState(initialStatus === 'READY')
  const statusRef = useRef(initialStatus)
  const audioCtxRef = useRef<AudioContext | null>(null)

  async function beep() {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') await ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.value = 0.15
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.3)
    } catch {
      // 音频不可用时静默
    }
  }

  useEffect(() => {
    if (initialStatus === 'READY') setReady(true)
    if (initialStatus === 'COMPLETED' || initialStatus === 'CANCELLED') return
    const id = setInterval(async () => {
      try {
        const s = await getTrackStatus(slug, orderNo, phone, guestKey, byIp)
        if (!s) return
        if (s !== statusRef.current) {
          statusRef.current = s
          // 状态变化（含 boss 推进/结账/取消）→ 刷新整页主数据（状态标签/进度条/加菜区/继续点菜按钮）。
          // 本组件只负责 READY 的即时语音/视觉提醒，整页数据由 router.refresh 对齐服务端最新状态
          router.refresh()
          if (s === 'READY') {
            setReady(true)
            void beep()
          } else {
            // 加菜后订单回退处理中（IN_PROGRESS）→ 撤销「已上桌/待取」横幅，避免残留误导
            setReady(false)
          }
        }
        if (s === 'COMPLETED' || s === 'CANCELLED') clearInterval(id)
      } catch {
        // 轮询失败静默，下一轮重试
      }
    }, 5000)
    return () => clearInterval(id)
  }, [slug, orderNo, phone, guestKey, byIp, initialStatus, router])

  if (!ready) return null

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center dark:border-green-800 dark:bg-green-950">
      <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-300">
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </svg>
        {t(orderType === 'dine_in' ? 'statusReadyHintDineIn' : 'statusReadyHint')}
      </p>
    </div>
  )
}
