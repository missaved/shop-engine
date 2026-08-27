'use client'

// 老板端左侧抽屉：点店名/汉堡滑出，收纳概览/收入/商品/设置，主页只留核心（提醒+订单）
import { ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export function SideDrawer({
  trigger,
  title,
  children,
}: {
  trigger: ReactNode
  title: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  // SSR 阶段 document 未定义，须在挂载后才 createPortal（避免 "document is not defined"）
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <>
      {/* 触发按钮：店名（点按打开抽屉） */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="打开设置"
        className="flex items-center gap-2 rounded-md px-1 py-1 text-left transition-opacity hover:opacity-75"
      >
        {trigger}
      </button>

      {/* 遮罩 + 抽屉渲染到 body：脱离 header 的 backdrop-filter 包含块（否则 fixed 被捕获、高度塌缩成一条） */}
      {mounted &&
        createPortal(
          <>
            {/* 遮罩（点击关闭） */}
            {open && (
              <div
                className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
                onClick={() => setOpen(false)}
              />
            )}

            {/* 抽屉：左侧滑出，收纳设置/收入/商品 */}
            <div
              className={`fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-sm flex-col bg-white shadow-2xl transition-transform duration-300 ease-out dark:bg-zinc-900 ${
                open ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
                <h2 className="text-lg font-semibold">{title}</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭"
                  className="text-2xl leading-none text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200"
                >
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
