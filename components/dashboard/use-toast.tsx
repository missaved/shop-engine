'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// 轻量 toast：show(msg) 显示提示，2 秒后自动消失（P0-5 操作反馈，无第三方依赖）
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const show = useCallback((m: string) => {
    setMsg(m)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 2000)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return { msg, show }
}

// 底部居中浮层（配合 useToast 渲染）
export function ToastView({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-2 text-sm text-white shadow-lg dark:bg-amber-500 dark:text-white">
      {msg}
    </div>
  )
}
