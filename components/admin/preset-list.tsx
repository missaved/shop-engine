// 中台预设库列表（第 19 批 A5）：每子分类显示道数/启用状态/模型/生成时间 + 启用禁用 + 重新生成
'use client'

import { useTransition } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { togglePresetActive, triggerPresetGenerate } from '@/lib/preset-actions'
import { useToast, ToastView } from '../dashboard/use-toast'

export type PresetRow = {
  subcategory: string
  name: string // 服务端拼好的显示名（vi · zh）
  cuisine: 'vn' | 'cn' | 'drink' // 第 20 批：菜系维度（越南菜/中国菜/酒水饮品）
  exists: boolean
  active: boolean
  itemCount: number
  modelUsed: string | null
  generatedAt: Date | null
}

const CUISINE_LABEL: Record<string, string> = { vn: '🇻🇳 越南菜', cn: '🇨🇳 中国菜', drink: '🍺 酒水饮品' }

export function PresetList({ rows }: { rows: PresetRow[] }) {
  const t = useTranslations('admin')
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const { msg, show } = useToast()

  // 第 20 批：按菜系分组（vn → cn → drink 固定顺序）
  const groups = (['vn', 'cn', 'drink'] as const)
    .map((cuisine) => ({ cuisine, rows: rows.filter((r) => r.cuisine === cuisine) }))
    .filter((g) => g.rows.length > 0)

  function run(fn: () => Promise<void>, okMsg: string) {
    startTransition(async () => {
      try {
        await fn()
        show(okMsg)
        router.refresh()
      } catch (e) {
        console.error('预设库操作失败:', e)
        show(e instanceof Error && e.message ? e.message : t('toastError'))
      }
    })
  }

  function onToggle(r: PresetRow) {
    run(
      () => togglePresetActive(r.cuisine, r.subcategory),
      r.active ? t('presetDisabled') : t('presetEnabled'),
    )
  }

  function onRegenerate(r: PresetRow) {
    if (!window.confirm(r.exists ? t('presetRegenConfirm') : t('presetRegenConfirmNew'))) return
    startTransition(async () => {
      try {
        const res = await triggerPresetGenerate(r.subcategory)
        if (res.ok) show(t('presetGeneratingStarted'))
        else show(res.error)
        router.refresh()
      } catch (e) {
        console.error('触发重新生成失败:', e)
        show(e instanceof Error && e.message ? e.message : t('toastError'))
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500">{t('presetListHint')}</p>
      {rows.length === 0 && <p className="text-sm text-zinc-500">{t('presetEmpty')}</p>}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-100 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2.5 font-medium">{t('presetColName')}</th>
              <th className="px-4 py-2.5 font-medium">{t('presetColItems')}</th>
              <th className="px-4 py-2.5 font-medium">{t('presetColStatus')}</th>
              <th className="px-4 py-2.5 font-medium">{t('presetColModel')}</th>
              <th className="px-4 py-2.5 font-medium">{t('presetColGenerated')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('presetColActions')}</th>
            </tr>
          </thead>
          <tbody>
            {/* 分组修复（2026-08-29 用户报「菜系没分类乱糟糟」）：组头必须与其行交错，否则所有组头堆顶部、行全在后面 */}
            {groups.flatMap((group) => [
              <tr
                key={`h-${group.cuisine}`}
                className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-800/40"
              >
                <td colSpan={6} className="px-4 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  {CUISINE_LABEL[group.cuisine]}
                </td>
              </tr>,
              ...group.rows.map((r) => (
                <tr key={r.subcategory} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-zinc-400">{r.subcategory}</div>
                  </td>
                  <td className="px-4 py-3">{r.exists ? r.itemCount : '—'}</td>
                  <td className="px-4 py-3">
                    {r.exists ? (
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                          r.active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                        }`}
                      >
                        {r.active ? t('presetActive') : t('presetInactive')}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400">{t('presetNever')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{r.exists ? (r.modelUsed ?? '—') : '—'}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {r.exists && r.generatedAt ? r.generatedAt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {r.exists && (
                        <Link
                          href={`/admin/${locale}/presets/${r.subcategory}`}
                          className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          {t('presetView')}
                        </Link>
                      )}
                      {r.exists && (
                        <button
                          onClick={() => onToggle(r)}
                          disabled={pending}
                          className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          {r.active ? t('presetDisable') : t('presetEnable')}
                        </button>
                      )}
                      <button
                        onClick={() => onRegenerate(r)}
                        disabled={pending}
                        className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                      >
                        {t('presetRegenerate')}
                      </button>
                    </div>
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <ToastView msg={msg} />
    </div>
  )
}
