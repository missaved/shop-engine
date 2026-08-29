// Admin「新增品类」（第 20 批）：注册自定义子分类 meta（PresetCategory）→ 可选立即触发后台生成
'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { createPresetCategory, triggerPresetGenerate } from '@/lib/preset-actions'
import { useToast, ToastView } from '../dashboard/use-toast'

const INITIAL = {
  key: '',
  nameVi: '',
  nameZh: '',
  nameEn: '',
  cuisine: 'vn',
  count: '40',
  examples: '',
  generate: false,
}

export function CreatePresetCategory() {
  const t = useTranslations('admin')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const { msg, show } = useToast()
  const [form, setForm] = useState(INITIAL)

  function set<K extends keyof typeof INITIAL>(k: K, v: (typeof INITIAL)[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function submit() {
    startTransition(async () => {
      try {
        const res = await createPresetCategory({
          key: form.key,
          nameVi: form.nameVi,
          nameZh: form.nameZh,
          nameEn: form.nameEn,
          cuisine: form.cuisine,
          count: Number(form.count),
          examples: form.examples,
        })
        if (!res.ok) {
          show(res.error)
          return
        }
        if (form.generate) {
          const g = await triggerPresetGenerate(res.key)
          if (!g.ok) {
            show(g.error)
            return
          }
        }
        show(t('catCreated'))
        setOpen(false)
        setForm(INITIAL)
        router.refresh()
      } catch (e) {
        console.error('新增品类失败:', e)
        show(e instanceof Error && e.message ? e.message : t('toastError'))
      }
    })
  }

  const inputCls =
    'w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {t('catNew')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-semibold">{t('catNew')}</h3>
              <p className="text-xs text-zinc-500">{t('catFormHint')}</p>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">{t('catKey')}</span>
              <input value={form.key} onChange={(e) => set('key', e.target.value)} className={inputCls} placeholder="nhau-dry / bao-bun" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500">{t('catNameVi')}</span>
                <input value={form.nameVi} onChange={(e) => set('nameVi', e.target.value)} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500">{t('catNameZh')}</span>
                <input value={form.nameZh} onChange={(e) => set('nameZh', e.target.value)} className={inputCls} />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">{t('catNameEn')}</span>
              <input value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} className={inputCls} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500">{t('catCuisine')}</span>
                <select value={form.cuisine} onChange={(e) => set('cuisine', e.target.value)} className={inputCls}>
                  <option value="vn">{t('catCuisineVn')}</option>
                  <option value="cn">{t('catCuisineCn')}</option>
                  <option value="drink">{t('catCuisineDrink')}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500">{t('catCount')}</span>
                <input
                  value={form.count}
                  onChange={(e) => set('count', e.target.value)}
                  type="number"
                  min="5"
                  max="80"
                  className={inputCls}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">{t('catExamples')}</span>
              <textarea
                value={form.examples}
                onChange={(e) => set('examples', e.target.value)}
                rows={3}
                placeholder="Bánh xèo 越式煎饼, Bánh khọt 迷你煎饼"
                className={inputCls}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.generate}
                onChange={(e) => set('generate', e.target.checked)}
                className="h-4 w-4"
              />
              {t('catGenerateNow')}
            </label>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t('presetRegenCancel')}
              </button>
              <button
                onClick={submit}
                disabled={pending || !form.key.trim() || !form.nameVi.trim() || !form.nameZh.trim()}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {pending ? t('presetRegenSubmitting') : t('catSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}
      <ToastView msg={msg} />
    </>
  )
}
