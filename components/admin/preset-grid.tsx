// Admin 全做（第 20 批）：预设单类图片网格 —— 逐张审核（占位标记 / 剔除 / 改 prompt 重生成单图）
'use client'

import { useState, useTransition } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { removePresetItem, regeneratePresetImage } from '@/lib/preset-actions'
import { useToast, ToastView } from '../dashboard/use-toast'

export type GridItem = {
  nativeName: string
  nameZh?: string
  nameEn?: string
  defaultPrice?: number
  imageUrl?: string
  imagePrompt?: string
}

export function PresetGrid({
  subcategory,
  cuisine,
  placeholderUrl,
  items,
  currency,
}: {
  subcategory: string
  cuisine: string
  placeholderUrl: string
  items: GridItem[]
  currency: string
}) {
  const t = useTranslations('admin')
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const { msg, show } = useToast()
  const [regen, setRegen] = useState<GridItem | null>(null)
  const [prompt, setPrompt] = useState('')

  function onRemove(it: GridItem) {
    if (!window.confirm(t('presetRemoveConfirm', { name: it.nativeName }))) return
    startTransition(async () => {
      try {
        const res = await removePresetItem(cuisine, subcategory, it.nativeName)
        if (res.ok) show(t('presetRemoveOk'))
        else show(res.error)
        router.refresh()
      } catch (e) {
        console.error('剔除失败:', e)
        show(e instanceof Error && e.message ? e.message : t('toastError'))
      }
    })
  }

  function openRegen(it: GridItem) {
    setRegen(it)
    setPrompt(it.imagePrompt ?? it.nativeName)
  }

  function submitRegen() {
    if (!regen) return
    startTransition(async () => {
      try {
        const res = await regeneratePresetImage(cuisine, subcategory, regen.nativeName, prompt)
        if (res.ok) show(t('presetRegenOk'))
        else show(res.error)
        setRegen(null)
        router.refresh()
      } catch (e) {
        console.error('重生成失败:', e)
        show(e instanceof Error && e.message ? e.message : t('toastError'))
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-300">{t('presetGridHint')}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((it, i) => {
          const isPlaceholder = it.imageUrl === placeholderUrl
          return (
            <div
              key={`${it.nativeName}-${i}`}
              className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="relative aspect-square w-full bg-zinc-100 dark:bg-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={it.imageUrl || placeholderUrl}
                  alt={it.nativeName}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {isPlaceholder && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-medium text-white">
                    {t('presetPlaceholder')}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-2.5">
                {/* 多语言修复（2026-08-29）：中文 locale 主名显示中文（nameZh），越南语为辅；其他 locale 反之 */}
                {(() => {
                  const zhMode = locale === 'zh' || locale === 'zh-Hant'
                  const mainName = zhMode && it.nameZh ? it.nameZh : it.nativeName
                  const subName = zhMode ? (it.nameZh ? it.nativeName : '') : it.nameZh ?? ''
                  return (
                    <>
                      <div className="text-sm font-medium leading-tight">{mainName}</div>
                      {subName && <div className="text-xs text-zinc-500 dark:text-zinc-300">{subName}</div>}
                    </>
                  )
                })()}
                <div className="text-xs text-zinc-500 dark:text-zinc-300">
                  {Number(it.defaultPrice ?? 0).toLocaleString('en-US')} {currency}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    onClick={() => openRegen(it)}
                    disabled={pending}
                    className="flex-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {t('presetRegenImage')}
                  </button>
                  <button
                    onClick={() => onRemove(it)}
                    disabled={pending}
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    {t('presetRemove')}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 改 prompt 重生成弹窗 */}
      {regen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRegen(null)}>
          <div
            className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-semibold">{t('presetRegenTitle')}</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-300">
                {regen.nativeName}
                {regen.nameZh ? ` · ${regen.nameZh}` : ''}
              </p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-300">{t('presetRegenPromptLabel')}</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-zinc-200 bg-white p-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRegen(null)}
                disabled={pending}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t('presetRegenCancel')}
              </button>
              <button
                onClick={submitRegen}
                disabled={pending || !prompt.trim()}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {pending ? t('presetRegenSubmitting') : t('presetRegenSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}
      <ToastView msg={msg} />
    </div>
  )
}
