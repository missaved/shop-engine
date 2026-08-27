'use client'

// 查单页实时状态：轮询订单状态，出餐(READY)时语音 + 横幅提示（客户端打开接收提醒）
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getTrackStatus } from '@/lib/actions'

export function TrackStatus({
  slug,
  orderNo,
  phone,
  guestKey,
  initialStatus,
}: {
  slug: string
  orderNo: string
  phone: string
  guestKey?: string
  initialStatus: string
}) {
  const t = useTranslations('track')
  const [ready, setReady] = useState(initialStatus === 'READY')
  const statusRef = useRef(initialStatus)
  const audioCtxRef = useRef<AudioContext | null>(null)

  function beep() {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      void audioCtxRef.current.resume()
      const ctx = audioCtxRef.current
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
        const s = await getTrackStatus(slug, orderNo, phone, guestKey)
        if (!s) return
        if (s !== statusRef.current) {
          statusRef.current = s
          if (s === 'READY') {
            setReady(true)
            beep()
          }
        }
        if (s === 'COMPLETED' || s === 'CANCELLED') clearInterval(id)
      } catch {
        // 轮询失败静默，下一轮重试
      }
    }, 15000)
    return () => clearInterval(id)
  }, [slug, orderNo, phone, guestKey, initialStatus])

  if (!ready) return null

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center dark:border-green-800 dark:bg-green-950">
      <p className="text-sm font-medium text-green-700 dark:text-green-300">
        ✅ {t('statusReadyHint')}
      </p>
    </div>
  )
}
