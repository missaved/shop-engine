'use client'

// 查单页状态区（顶部状态文字 + 进度条 + 出餐横幅）：唯一响应式状态源。
// 2026-08-31 根因修复：原实现「文字/进度条」由服务端 order.status 渲染（靠 router.refresh 才更新），
// 「横幅」由客户端 ready state 驱动（轮询即时更新）。生产上这两路读值不同（Neon 读分流），
// 且 statusRef 置新后 poll===ref 不再触发 refresh → 服务端旧渲染死锁，出现「文字/进度条停在已上桌、横幅却变/或反之」。
// 修复：三块全部由同一 status 状态（轮询 getTrackStatus 新值）驱动，单源一致、吃到新值。
// pollActive=false（无 phone/guestKey/ip 凭证，仅静态查看）时不轮询、不显横幅，行为与旧静态视图一致。
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getTrackStatus } from '@/lib/actions'
import { useRouter } from '@/i18n/navigation'

// 订单状态 → 本地化 key（track 段；原在 track/page.tsx，随状态区一并迁到客户端）
const STATUS_KEY: Record<string, string> = {
  PENDING: 'statusPending',
  IN_PROGRESS: 'statusInProgress',
  READY: 'statusReady',
  COMPLETED: 'statusCompleted',
  CANCELLED: 'statusCancelled',
}

// 堂食店内用餐：READY 不显示「待取」，改「已上桌」；外带/外送维持「待取」。
// orderType 可选（客户端 prop），未指定默认堂食（与服务端 orderCfg.orderType ?? 'dine_in' 一致）
function statusKey(status: string, orderType?: string): string {
  const ot = orderType ?? 'dine_in'
  if (status === 'READY' && ot === 'dine_in') return 'statusReadyDineIn'
  return STATUS_KEY[status] ?? 'statusPending'
}

export function TrackStatus({
  slug,
  orderNo,
  phone,
  guestKey,
  byIp,
  initialStatus,
  orderType,
  pollActive,
}: {
  slug: string
  orderNo: string
  phone: string
  guestKey?: string
  byIp?: boolean
  initialStatus: string
  orderType?: string
  pollActive: boolean
}) {
  const t = useTranslations('track')
  const router = useRouter()
  // 唯一状态源：初值用服务端渲染值，之后由轮询覆盖（文字/进度条/横幅全读它）
  const [status, setStatus] = useState(initialStatus)
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
    // 无凭证静态查看：不轮询（订单仅按服务端渲染值显示；终态也无需轮询）
    if (!pollActive) return
    if (initialStatus === 'COMPLETED' || initialStatus === 'CANCELLED') return
    const id = setInterval(async () => {
      try {
        const s = await getTrackStatus(slug, orderNo, phone, guestKey, byIp)
        if (!s) return
        if (s !== statusRef.current) {
          statusRef.current = s
          setStatus(s) // 文字/进度条/横幅随 s 同步更新（单源）
          // 仍刷新整页主数据（商品列表/加菜区/继续点菜按钮），但这些不再决定状态区显示
          router.refresh()
          if (s === 'READY') void beep()
        }
      } catch {
        // 轮询失败静默，下一轮重试
      }
    }, 5000)
    return () => clearInterval(id)
  }, [slug, orderNo, phone, guestKey, byIp, initialStatus, pollActive, router])

  const stepIdx = ['PENDING', 'IN_PROGRESS', 'READY', 'COMPLETED'].indexOf(status)

  return (
    <>
      {/* 顶部状态文字（右对齐；原与 displayNo 同行，现随状态区下移一行） */}
      <div className="flex items-center justify-end">
        <span className="text-lg text-zinc-600 dark:text-zinc-400">
          {t(statusKey(status, orderType))}
        </span>
      </div>

      {/* 订单进度条：已下单 → 制作中 → 待取/已上桌 → 完成（取消单停止在所在步并置灰） */}
      {status !== 'CANCELLED' && (
        <div className="mt-1">
          <div className="flex items-center">
            {[
              { key: 'PENDING', labelKey: 'statusPending' },
              { key: 'IN_PROGRESS', labelKey: 'statusInProgress' },
              { key: 'READY', labelKey: statusKey('READY', orderType) },
              { key: 'COMPLETED', labelKey: 'statusCompleted' },
            ].map((step, i, arr) => {
              const reached = i <= stepIdx
              const isLast = i === arr.length - 1
              return (
                <div key={step.key} className="flex flex-1 items-center last:flex-none">
                  <div
                    className="flex items-center justify-center rounded-full text-xs font-semibold"
                    style={{
                      width: 30,
                      height: 30,
                      background: reached ? '#f59e0b' : '#e4e4e7',
                      color: reached ? '#fff' : '#9ca3af',
                    }}
                  >
                    {i + 1}
                  </div>
                  {!isLast && (
                    <div
                      className="mx-1 h-0.5 flex-1 rounded"
                      style={{ background: i < stepIdx ? '#f59e0b' : '#e4e4e7' }}
                    />
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-1 flex justify-between text-sm text-zinc-400">
            <span>{t('statusPending')}</span>
            <span className="flex-1 text-center">{t('statusInProgress')}</span>
            <span className="flex-1 text-center">{t(statusKey('READY', orderType))}</span>
            <span>{t('statusCompleted')}</span>
          </div>
        </div>
      )}

      {/* 出餐横幅：READY 时显示，随 status 变化自动出现/撤回；仅轮询激活时显示（静态查看同旧行为不显示） */}
      {pollActive && status === 'READY' && (
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
      )}
    </>
  )
}
