'use client'
// M4.4 admin 中台 moto 预设库管理：列表 + 新增/编辑（三语名/默认价/单位/分类/保养类型/间隔）+ 停用
// MotoPreset 独立表（一服务一行），与 food PresetList 数据结构不同，独立组件
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import {
  listMotoPresets,
  saveMotoPreset,
  toggleMotoPresetActive,
  type AdminMotoPreset,
} from '@/lib/moto-preset-actions'
import { useToast, ToastView } from '../dashboard/use-toast'

const CATEGORIES = ['bảo dưỡng', 'sửa chữa', 'kiểm tra']
const MAINT_TYPES = ['OIL', 'PERIODIC', 'REPAIR']

type FormState = {
  id?: string
  serviceKey: string
  nameVi: string
  nameZh: string
  nameEn: string
  defaultPrice: string
  unit: string
  category: string
  maintenanceType: string
  intervalKm: string
  intervalDays: string
  active: boolean
}

const emptyForm = (): FormState => ({
  serviceKey: '',
  nameVi: '',
  nameZh: '',
  nameEn: '',
  defaultPrice: '0',
  unit: '',
  category: CATEGORIES[0],
  maintenanceType: 'OIL',
  intervalKm: '',
  intervalDays: '',
  active: true,
})

export function MotoPresetManager({ initial }: { initial: AdminMotoPreset[] }) {
  const t = useTranslations('admin')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const { msg, show } = useToast()
  const [rows, setRows] = useState<AdminMotoPreset[]>(initial)
  const [form, setForm] = useState<FormState | null>(null)

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f))

  function reload() {
    startTransition(async () => {
      try {
        setRows(await listMotoPresets())
      } catch (e) {
        console.error('加载 moto 预设失败:', e)
      }
    })
  }

  function onSave() {
    if (!form) return
    if (!form.serviceKey.trim() || !form.nameVi.trim()) {
      show(t('mpNeedKey'))
      return
    }
    startTransition(async () => {
      const res = await saveMotoPreset({
        id: form.id,
        serviceKey: form.serviceKey,
        nameVi: form.nameVi,
        nameZh: form.nameZh,
        nameEn: form.nameEn,
        defaultPrice: Number(form.defaultPrice) || 0,
        unit: form.unit || null,
        category: form.category,
        maintenanceType: form.maintenanceType,
        intervalKm: form.intervalKm ? Number(form.intervalKm) : null,
        intervalDays: form.intervalDays ? Number(form.intervalDays) : null,
        active: form.active,
      })
      if (res.ok) {
        show(t('mpSaved'))
        setForm(null)
        reload()
        router.refresh()
      } else {
        show(res.error)
      }
    })
  }

  function onToggle(id: string) {
    startTransition(async () => {
      await toggleMotoPresetActive(id)
      reload()
      router.refresh()
    })
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-300">{t('mpHint')}</p>
        <button
          onClick={() => setForm(emptyForm())}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t('mpNew')}
        </button>
      </div>

      {form && (
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-300">
              {t('mpServiceKey')}
              <input
                className={inputCls}
                value={form.serviceKey}
                onChange={(e) => set({ serviceKey: e.target.value })}
                placeholder="oil_change"
                disabled={!!form.id}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-300">
              {t('mpNameVi')}
              <input
                className={inputCls}
                value={form.nameVi}
                onChange={(e) => set({ nameVi: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-300">
              {t('mpNameZh')}
              <input
                className={inputCls}
                value={form.nameZh}
                onChange={(e) => set({ nameZh: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-300">
              {t('mpNameEn')}
              <input
                className={inputCls}
                value={form.nameEn}
                onChange={(e) => set({ nameEn: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-300">
              {t('mpPrice')}
              <input
                className={inputCls}
                type="number"
                value={form.defaultPrice}
                onChange={(e) => set({ defaultPrice: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-300">
              {t('mpUnit')}
              <input
                className={inputCls}
                value={form.unit}
                onChange={(e) => set({ unit: e.target.value })}
                placeholder="次/升/个"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-300">
              {t('mpCategory')}
              <select
                className={inputCls}
                value={form.category}
                onChange={(e) => set({ category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-300">
              {t('mpMaint')}
              <select
                className={inputCls}
                value={form.maintenanceType}
                onChange={(e) => set({ maintenanceType: e.target.value })}
              >
                {MAINT_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-300">
              {t('mpKm')}
              <input
                className={inputCls}
                type="number"
                value={form.intervalKm}
                onChange={(e) => set({ intervalKm: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-300">
              {t('mpDays')}
              <input
                className={inputCls}
                type="number"
                value={form.intervalDays}
                onChange={(e) => set({ intervalDays: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 pt-5 text-xs text-zinc-500 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set({ active: e.target.checked })}
              />
              {t('mpActive')}
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={pending}
              className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {t('mpSave')}
            </button>
            <button
              onClick={() => setForm(null)}
              className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700"
            >
              {t('mpCancel')}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-100 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-300">
            <tr>
              <th className="px-4 py-2.5 font-medium">{t('mpServiceKey')}</th>
              <th className="px-4 py-2.5 font-medium">{t('mpColName')}</th>
              <th className="px-4 py-2.5 font-medium">{t('mpPrice')}</th>
              <th className="px-4 py-2.5 font-medium">{t('mpCategory')}</th>
              <th className="px-4 py-2.5 font-medium">{t('mpMaint')}</th>
              <th className="px-4 py-2.5 font-medium">{t('mpColStatus')}</th>
              <th className="px-4 py-2.5 font-medium">{t('mpColActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-zinc-400 dark:text-zinc-300">
                  {t('mpEmpty')}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                <td className="px-4 py-2.5 font-mono text-xs">{r.serviceKey}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{r.nameVi}</div>
                  <div className="text-xs text-zinc-400 dark:text-zinc-300">
                    {r.nameZh} · {r.nameEn}
                  </div>
                </td>
                <td className="px-4 py-2.5">{r.defaultPrice}</td>
                <td className="px-4 py-2.5 text-xs">{r.category}</td>
                <td className="px-4 py-2.5 text-xs">
                  {r.maintenanceType}
                  {(r.intervalKm != null || r.intervalDays != null) && (
                    <div className="text-zinc-400 dark:text-zinc-300">
                      {r.intervalKm != null && `${r.intervalKm}km`}
                      {r.intervalDays != null && ` / ${r.intervalDays}d`}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      r.active
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
                    }`}
                  >
                    {r.active ? t('mpEnabled') : t('mpDisabled')}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1.5">
                    <button
                      onClick={() =>
                        setForm({
                          id: r.id,
                          serviceKey: r.serviceKey,
                          nameVi: r.nameVi,
                          nameZh: r.nameZh,
                          nameEn: r.nameEn,
                          defaultPrice: r.defaultPrice,
                          unit: r.unit ?? '',
                          category: r.category,
                          maintenanceType: r.maintenanceType,
                          intervalKm: r.intervalKm != null ? String(r.intervalKm) : '',
                          intervalDays: r.intervalDays != null ? String(r.intervalDays) : '',
                          active: r.active,
                        })
                      }
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
                    >
                      {t('mpEdit')}
                    </button>
                    <button
                      onClick={() => onToggle(r.id)}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
                    >
                      {r.active ? t('mpDisable') : t('mpEnable')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ToastView msg={msg} />
    </div>
  )
}
