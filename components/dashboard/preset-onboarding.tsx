// AI 预设上架引导（第 19 批 A6 / 决策 8.4、9.1、9.2）：勾选子分类 → 拉 ShopDraft 草稿 → 可编辑 → 一键上架（覆盖强确认/可还原）
'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { publishShopDraft, restoreShopDraft, saveShopDraft, type DraftItem } from '@/lib/preset-actions'
import { useToast, ToastView } from './use-toast'

export type PresetOption = {
  subcategory: string
  name: string // vi · zh 显示名
  count: number // 预设道数（0=未生成）
  active: boolean
  cuisine: 'vn' | 'cn' | 'drink' // 第 20 批：中越拆分/酒水（老板勾选时按菜系分组）
}

export function PresetOnboarding({
  presets,
  draftItems,
  hasSnapshot,
  currency,
}: {
  presets: PresetOption[]
  draftItems: DraftItem[]
  hasSnapshot: boolean
  currency: string
}) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const { msg, show } = useToast()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [items, setItems] = useState<DraftItem[]>(draftItems)
  // 选择性上架：草稿项勾选状态（默认不勾选，避免几十个菜只上几个却要点掉全部取消；仅上架勾选项）
  const [checked, setChecked] = useState<boolean[]>(() => draftItems.map(() => false))

  // 服务端草稿更新（加载/上架后 props 变）→ 同步本地可编辑态；新草稿默认不勾选
  useEffect(() => {
    setItems(draftItems)
    setChecked(draftItems.map(() => false))
  }, [draftItems])

  // boss 端语种 → 草稿菜名显示/编辑对应字段（zh→nameZh、en→nameEn、其余→nativeName）
  const zhMode = locale === 'zh' || locale === 'zh-Hant'
  const localeLabel = zhMode ? '中文' : locale === 'en' ? 'EN' : 'VI'
  const dispNameOf = (it: DraftItem) =>
    zhMode ? it.nameZh || it.nativeName : locale === 'en' ? it.nameEn || it.nativeName : it.nativeName

  const usablePresets = useMemo(() => presets.filter((p) => p.active && p.count > 0), [presets])
  const selectedCount = usablePresets.filter((p) => selected.has(p.subcategory)).reduce((s, p) => s + p.count, 0)

  // 第 20 批：按菜系分组展示（越南菜 / 中国菜 / 酒水饮品）
  const cuisineGroups: { key: 'vn' | 'cn' | 'drink'; presets: PresetOption[] }[] = useMemo(() => {
    const order: ('vn' | 'cn' | 'drink')[] = ['vn', 'cn', 'drink']
    return order
      .map((key) => ({ key, presets: usablePresets.filter((p) => p.cuisine === key) }))
      .filter((g) => g.presets.length > 0)
  }, [usablePresets])
  const CUISINE_LABEL: Record<string, string> = { vn: '🇻🇳 越南菜', cn: '🇨🇳 中国菜', drink: '🍺 酒水饮品' }

  function toggleSub(sub: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(sub)) next.delete(sub)
      else next.add(sub)
      return next
    })
  }

  function onLoad() {
    if (!selected.size) {
      show(t('presetPickSub'))
      return
    }
    const subs = [...selected]
    startTransition(async () => {
      try {
        const res = await saveShopDraft(subs)
        if (res.ok) show(`${t('presetLoaded')} (${res.count} ${t('presetDishes')})`)
        else show(res.error)
        router.refresh()
      } catch (e) {
        console.error('加载草稿失败:', e)
        show(e instanceof Error && e.message ? e.message : t('toastError'))
      }
    })
  }

  function patchItem(i: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }

  function toggleChecked(i: number) {
    setChecked((prev) => prev.map((c, idx) => (idx === i ? !c : c)))
  }

  // 按 boss 端语种更新菜名（zh→nameZh、en→nameEn、其余→nativeName；主名 nativeName 保持越南语）
  function patchName(i: number, v: string) {
    if (zhMode) patchItem(i, { nameZh: v })
    else if (locale === 'en') patchItem(i, { nameEn: v })
    else patchItem(i, { nativeName: v })
  }

  function onPublish() {
    if (!checked.some(Boolean)) {
      show(t('presetPickItem'))
      return
    }
    // 仅上架勾选的草稿项（追加模式，2026-08-29 用户反馈：不清空现有商品）
    const kept = items
      .filter((_, i) => checked[i] ?? false)
      .filter((it) => it.price > 0 && it.nativeName.trim())
    if (!kept.length) {
      show(t('presetNoValidItem'))
      return
    }
    if (!window.confirm(t('presetPublishConfirm', { count: String(kept.length) }))) return
    startTransition(async () => {
      try {
        const res = await publishShopDraft(kept)
        if (res.ok) show(`${t('presetPublished')} (${res.count} ${t('presetDishes')})`)
        else show(res.error)
        router.refresh()
      } catch (e) {
        console.error('上架失败:', e)
        show(e instanceof Error && e.message ? e.message : t('toastError'))
      }
    })
  }

  function onRestore() {
    if (!window.confirm(t('presetRestoreConfirm'))) return
    startTransition(async () => {
      try {
        const res = await restoreShopDraft()
        if (res.ok) show(`${t('presetRestored')} (${res.count} ${t('presetDishes')})`)
        else show(res.error)
        router.refresh()
      } catch (e) {
        console.error('还原失败:', e)
        show(e instanceof Error && e.message ? e.message : t('toastError'))
      }
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
      <div>
        <h2 className="text-base font-medium">{t('presetOnboardTitle')}</h2>
        <p className="text-xs text-zinc-500">{t('presetOnboardHint')}</p>
      </div>

      {usablePresets.length === 0 ? (
        <p className="text-sm text-zinc-500">{t('presetNoPreset')}</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {cuisineGroups.map((group) => (
              <div key={group.key} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-zinc-500">{CUISINE_LABEL[group.key]}</span>
                <div className="flex flex-wrap gap-2">
                  {group.presets.map((p) => (
                    <label
                      key={p.subcategory}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        selected.has(p.subcategory)
                          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={selected.has(p.subcategory)}
                        onChange={() => toggleSub(p.subcategory)}
                      />
                      <span className="text-xs font-medium">{p.name}</span>
                      <span className="text-xs opacity-70">{p.count}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onLoad}
              disabled={pending || !selected.size}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {t('presetLoad')} {selectedCount > 0 ? `(${selectedCount})` : ''}
            </button>
            <span className="text-xs text-zinc-500">{t('presetSelected', { count: String(selected.size) })}</span>
          </div>
        </>
      )}

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              {t('presetDraftTitle')}（{items.length}）
              <span className="ml-1 text-xs font-normal text-zinc-400">
                {t('presetSelected', { count: String(checked.filter(Boolean).length) })}
              </span>
            </h3>
            <div className="flex gap-2">
              {hasSnapshot && (
                <button
                  onClick={onRestore}
                  disabled={pending}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {t('presetRestore')}
                </button>
              )}
              <button
                onClick={onPublish}
                disabled={pending}
                className="rounded-md bg-green-600 px-3 py-1 text-xs text-white transition-colors hover:bg-green-500 disabled:opacity-50"
              >
                {t('presetPublish')}
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            {items.map((it, i) => (
              <div key={i} className="flex items-start gap-2 border-b border-zinc-100 p-3 last:border-0 sm:items-center dark:border-zinc-800">
                <input
                  type="checkbox"
                  checked={checked[i] ?? false}
                  onChange={() => toggleChecked(i)}
                  className="mt-1 h-4 w-4 shrink-0 accent-green-600 sm:mt-0"
                  aria-label={t('presetPickItem')}
                />
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.imageUrl} alt={it.nativeName} className="h-12 w-12 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-lg dark:bg-zinc-800">🍽️</span>
                )}
                <div className="flex flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex w-full flex-col gap-0.5 sm:w-44">
                    <input
                      value={dispNameOf(it)}
                      onChange={(e) => patchName(i, e.target.value)}
                      className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      aria-label={t('presetName')}
                    />
                    <span className="text-[10px] text-zinc-400">
                      {localeLabel}
                      {!zhMode && locale !== 'en' && it.nameZh ? ` · ${it.nameZh}` : ''}
                    </span>
                  </div>
                  <input
                    value={it.price || ''}
                    type="number"
                    min="1"
                    onChange={(e) => patchItem(i, { price: Number(e.target.value) })}
                    className="w-28 rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    aria-label={t('presetPrice')}
                  />
                  <span className="text-xs text-zinc-400">{currency}</span>
                  {(it.dietaryTags ?? []).length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {(it.dietaryTags ?? []).map((tag) => (
                        <span key={tag} className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ToastView msg={msg} />
    </section>
  )
}
