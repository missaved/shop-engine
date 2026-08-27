'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  createProduct,
  reorderProducts,
  toggleProductActive,
  toggleShopOpen,
  updateProduct,
  updateShopSettings,
} from '@/lib/actions'
import type { ShopPlain } from './order-list'
import { useToast, ToastView } from './use-toast'
import { formatPrice } from '@/lib/format'

// 上传本地图片到 /api/upload（multipart），返回可直访的静态 URL（/uploads/xxx）
async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: form })
  const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null
  if (!res.ok || !data?.url) {
    throw new Error(data?.error ?? '上传失败')
  }
  return data.url
}

// 加料数组 → 文本行（每行「名称 价格」，价格为 0 时省略，供编辑回显）
function serializeExtras(extras: { name: string; price: string }[]): string {
  return extras
    .map((e) => (Number(e.price) > 0 ? `${e.name} ${e.price}` : e.name))
    .join('\n')
}

// 规格组数组 → 文本行（每行「组名[*]: 选项1, 选项2|价格」，* 必选，| 选项加价）
function serializeOptionGroups(
  groups: { name: string; required: boolean; options: { name: string; price: string }[] }[],
): string {
  return groups
    .map((g) => {
      const opts = g.options
        .map((o) => (Number(o.price) > 0 ? `${o.name}|${o.price}` : o.name))
        .join(', ')
      return `${g.name}${g.required ? '*' : ''}: ${opts}`
    })
    .join('\n')
}

// 套餐组成数组 → 文本行（每行「商品名 数量」，数量为 1 时省略，供编辑回显）
function serializeCombo(combo: { name: string; qty: number }[]): string {
  return combo
    .map((c) => (c.qty > 1 ? `${c.name} ${c.qty}` : c.name))
    .join('\n')
}

// 加料文本 → 预览数组（与 actions.ts parseExtras 同规则，客户端预览用）
function previewExtras(text: string): { name: string; price: number }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)\s+(\d+)$/)
      return m ? { name: m[1].trim(), price: Number(m[2]) } : { name: line, price: 0 }
    })
    .filter((e) => e.name)
}

// 套餐组成文本 → 预览数组（与 actions.ts parseCombo 同规则，客户端预览用）
function previewCombo(text: string): { name: string; qty: number }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)\s+(\d+)$/)
      return m ? { name: m[1].trim(), qty: Number(m[2]) } : { name: line, qty: 1 }
    })
    .filter((c) => c.name && c.qty > 0)
}

// 预置单位 / 分类 / 图标选项（下拉建议，仍可自由输入自定义值）
const UNIT_OPTIONS = ['tô', 'ly', 'phần', 'đĩa', 'chai', 'hộp', 'xiên', 'cái', 'ổ', 'kg']
const CATEGORY_OPTIONS = [
  'Phở',
  'Đồ uống',
  'Cơm',
  'Bún',
  'Món chính',
  'Khai vị',
  'Tráng miệng',
  'Ăn vặt',
]
const EMOJI_OPTIONS = [
  '🍜',
  '🍚',
  '🍲',
  '🍛',
  '🍹',
  '☕',
  '🥤',
  '🍺',
  '🍗',
  '🥩',
  '🍤',
  '🥗',
  '🍰',
  '🍮',
]

export type ProductPlain = {
  id: string
  name: string
  price: string
  active: boolean
  emoji: string
  unit: string | null
  category: string | null
  image: string
  nameZh: string
  nameEn: string
  descVi: string
  descZh: string
  descEn: string
  extras: { name: string; price: string }[]
  optionGroups: {
    name: string
    required: boolean
    options: { name: string; price: string }[]
  }[]
  combo: { name: string; qty: number }[]
  bestseller: boolean
}

// 老板侧设置：营业开关 / 商品售罄 / 营业时间 / 起送价
export function SettingsPanel({
  products,
  shop,
}: {
  products: ProductPlain[]
  shop: ShopPlain
}) {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [openHours, setOpenHours] = useState(shop.config?.openHours ?? '')
  const [minOrderAmount, setMinOrderAmount] = useState<number>(
    shop.config?.minOrderAmount ?? 0,
  )
  const [deliveryFee, setDeliveryFee] = useState<number>(
    shop.config?.deliveryFee ?? 0,
  )
  const [packingFee, setPackingFee] = useState<number>(
    shop.config?.packingFee ?? 0,
  )
  const [deliveryArea, setDeliveryArea] = useState<string>(
    shop.config?.deliveryArea ?? '',
  )
  const [description, setDescription] = useState<string>(
    shop.config?.description ?? '',
  )
  const [saved, setSaved] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const { msg, show } = useToast()

  function run(fn: () => Promise<void>, okMsg?: string) {
    startTransition(async () => {
      try {
        await fn()
        if (okMsg) show(okMsg)
        router.refresh()
      } catch (e) {
        console.error('操作失败:', e)
        show(t('toastError'))
      }
    })
  }

  // 上移/下移：交换相邻商品后整表重排 sortOrder（dir：-1 上移，+1 下移）
  function moveProduct(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= products.length) return
    const next = [...products]
    ;[next[index], next[target]] = [next[target], next[index]]
    run(() => reorderProducts({ productIds: next.map((p) => p.id) }))
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    await updateShopSettings({
      openHours,
      minOrderAmount: Number(minOrderAmount),
      deliveryFee: Number(deliveryFee),
      packingFee: Number(packingFee),
      deliveryArea,
      description,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    router.refresh()
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">{t('toggleOpen')}</h2>

      {/* 营业开关（开=绿 / 关=红，切换有 toast 提示） */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            shop.open
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
          }`}
        >
          {shop.open ? t('open') : t('closed')}
        </span>
        <button
          onClick={() =>
            run(toggleShopOpen, shop.open ? t('toastClosed') : t('toastOpened'))
          }
          disabled={pending}
          className={`rounded-md px-3 py-2 text-sm transition-colors disabled:opacity-60 ${
            shop.open
              ? 'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {shop.open ? t('closed') : t('open')}
        </button>
      </div>

      {/* 商品管理：售罄 / 编辑 */}
      <div className="flex flex-col gap-2">
        {products.map((p, index) => (
          <div
            key={p.id}
            className="flex flex-col rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">{p.emoji}</span>
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-sm text-zinc-500">
                  {formatPrice(Number(p.price))}đ
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => moveProduct(index, -1)}
                  disabled={index === 0 || pending}
                  aria-label="上移"
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveProduct(index, 1)}
                  disabled={index === products.length - 1 || pending}
                  aria-label="下移"
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  ↓
                </button>
                <button
                  onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {t('edit')}
                </button>
                <button
                  onClick={() => run(() => toggleProductActive(p.id))}
                  disabled={pending}
                  className={
                    p.active
                      ? 'rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'
                      : 'rounded-md bg-red-100 px-3 py-1.5 text-xs text-red-700 transition-colors dark:bg-red-900 dark:text-red-300'
                  }
                >
                  {p.active ? t('onSale') : t('soldOut')}
                </button>
              </div>
            </div>
            {editingId === p.id && (
              <div className="px-4 pb-4">
                <EditProductForm
                  product={p}
                  onDone={() => setEditingId(null)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <AddProductForm onAdded={() => router.refresh()} />

      {/* 营业时间 / 起送价 */}
      <form
        onSubmit={saveSettings}
        className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {t('openHours')}
          </span>
          <input
            type="text"
            value={openHours}
            onChange={(e) => setOpenHours(e.target.value)}
            placeholder="07:00-22:00"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {t('minOrder')}
          </span>
          <input
            type="number"
            value={minOrderAmount}
            onChange={(e) => setMinOrderAmount(Number(e.target.value))}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {t('deliveryFee')}
          </span>
          <input
            type="number"
            value={deliveryFee}
            onChange={(e) => setDeliveryFee(Number(e.target.value))}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {t('packingFee')}
          </span>
          <input
            type="number"
            value={packingFee}
            onChange={(e) => setPackingFee(Number(e.target.value))}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {t('deliveryArea')}
          </span>
          <input
            type="text"
            value={deliveryArea}
            onChange={(e) => setDeliveryArea(e.target.value)}
            placeholder="Q.1, Q.3, 5km 内"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {t('shopDescription')}
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Phở bò truyền thống, nước dùng hầm xương 12 tiếng…"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-amber-500 px-3 py-2 text-sm text-white transition-colors hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-500 dark:text-white"
        >
          {saved ? t('saved') : t('save')}
        </button>
      </form>
      <ToastView msg={msg} />
    </section>
  )
}

// 新增商品表单：名称/价格/单位/图标/介绍（图片 URL 与三语名翻译留 B8）
function AddProductForm({ onAdded }: { onAdded: () => void }) {
  const t = useTranslations('dashboard')
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [unit, setUnit] = useState('')
  const [category, setCategory] = useState('')
  const [emoji, setEmoji] = useState('')
  const [desc, setDesc] = useState('')
  const [image, setImage] = useState('')
  const [extrasText, setExtrasText] = useState('')
  const [optionGroupsText, setOptionGroupsText] = useState('')
  const [comboText, setComboText] = useState('')
  const [bestseller, setBestseller] = useState(false)
  const [uploading, setUploading] = useState(false)

  // 选本地图/拍照 → 上传 → 回填 URL
  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    try {
      setImage(await uploadImage(f))
    } catch (err) {
      console.error('上传图片失败:', err)
    } finally {
      setUploading(false)
      e.target.value = '' // 清空，允许重复选同一文件
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      try {
        await createProduct({
          name,
          price: Number(price),
          unit: unit || undefined,
          category: category || undefined,
          emoji: emoji || undefined,
          desc: desc || undefined,
          image: image || undefined,
          extrasText,
          optionGroupsText,
          comboText,
          bestseller,
        })
        setName('')
        setCategory('')
        setExtrasText('')
        setOptionGroupsText('')
        setComboText('')
        setBestseller(false)
        setPrice('')
        setUnit('')
        setEmoji('')
        setDesc('')
        setImage('')
        onAdded()
      } catch (err) {
        console.error('新增商品失败:', err)
      }
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h3 className="text-sm font-medium">{t('addProduct')}</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('productName')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('price')}</span>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('unit')}</span>
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="tô / ly / ổ"
            list="unit-options-add"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('category')}</span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Phở / Đồ uống"
            list="category-options-add"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('emoji')}</span>
          <input
            type="text"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🍜"
            list="emoji-options-add"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
      </div>
      <datalist id="unit-options-add">
        {UNIT_OPTIONS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="category-options-add">
        {CATEGORY_OPTIONS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="emoji-options-add">
        {EMOJI_OPTIONS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{t('desc')}</span>
        <input
          type="text"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{t('image')}</span>
        <div className="flex items-center gap-2">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPickImage}
            disabled={uploading}
            className="text-sm"
          />
          {uploading && <span className="text-xs text-zinc-400">{t('uploading')}</span>}
        </div>
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            className="mt-2 h-16 w-16 rounded-lg object-cover"
          />
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{t('extras')}</span>
        <textarea
          value={extrasText}
          onChange={(e) => setExtrasText(e.target.value)}
          rows={3}
          placeholder={t('extrasHint')}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{t('optionGroups')}</span>
        <textarea
          value={optionGroupsText}
          onChange={(e) => setOptionGroupsText(e.target.value)}
          rows={3}
          placeholder={t('optionGroupsHint')}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{t('combo')}</span>
        <textarea
          value={comboText}
          onChange={(e) => setComboText(e.target.value)}
          rows={2}
          placeholder={t('comboHint')}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={bestseller}
          onChange={(e) => setBestseller(e.target.checked)}
        />
        <span className="text-zinc-600 dark:text-zinc-400">🔥 {t('bestseller')}</span>
      </label>

      {/* 预览：客户视角的商品卡片（填写名称后实时显示，保存前确认效果） */}
      {name.trim() && (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
          <p className="mb-2 text-xs font-semibold text-zinc-500">{t('preview')}</p>
          <div className="flex items-center gap-3">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="h-14 w-14 rounded-lg object-cover" />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-100 text-2xl dark:bg-zinc-800">
                {emoji || '🍽️'}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{name}</div>
              {desc && <p className="line-clamp-1 text-xs text-zinc-500">{desc}</p>}
              <div className="text-sm font-semibold text-amber-600 dark:text-amber-500">
                {formatPrice(Number(price) || 0)}đ
                {unit ? ` / ${unit}` : ''}
              </div>
            </div>
          </div>
          {previewExtras(extrasText).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {previewExtras(extrasText).map((ex, i) => (
                <span
                  key={i}
                  className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {ex.name}
                  {ex.price > 0 ? ` +${formatPrice(ex.price)}đ` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-amber-500 px-3 py-2 text-sm text-white transition-colors hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-500 dark:text-white"
      >
        {t('add')}
      </button>
    </form>
  )
}

// 编辑商品表单：改价/改图/改三语名/改三语描述（B8 菜单翻译）
function EditProductForm({
  product,
  onDone,
}: {
  product: ProductPlain
  onDone: () => void
}) {
  const t = useTranslations('dashboard')
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(product.name)
  const [price, setPrice] = useState(product.price)
  const [unit, setUnit] = useState(product.unit ?? '')
  const [category, setCategory] = useState(product.category ?? '')
  const [emoji, setEmoji] = useState(product.emoji)
  const [image, setImage] = useState(product.image)
  const [uploading, setUploading] = useState(false)
  const [nameZh, setNameZh] = useState(product.nameZh)
  const [nameEn, setNameEn] = useState(product.nameEn)
  const [descVi, setDescVi] = useState(product.descVi)
  const [descZh, setDescZh] = useState(product.descZh)
  const [descEn, setDescEn] = useState(product.descEn)
  const [extrasText, setExtrasText] = useState(serializeExtras(product.extras))
  const [optionGroupsText, setOptionGroupsText] = useState(
    serializeOptionGroups(product.optionGroups),
  )
  const [comboText, setComboText] = useState(serializeCombo(product.combo))
  const [bestseller, setBestseller] = useState(product.bestseller)

  // 选本地图/拍照 → 上传 → 回填 URL
  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    try {
      setImage(await uploadImage(f))
    } catch (err) {
      console.error('上传图片失败:', err)
    } finally {
      setUploading(false)
      e.target.value = '' // 清空，允许重复选同一文件
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      try {
        await updateProduct({
          productId: product.id,
          name,
          price: Number(price),
          unit: unit || undefined,
          category: category || undefined,
          emoji: emoji || undefined,
          image: image || undefined,
          nameZh: nameZh || undefined,
          nameEn: nameEn || undefined,
          descVi: descVi || undefined,
          descZh: descZh || undefined,
          descEn: descEn || undefined,
          extrasText,
          optionGroupsText,
          comboText,
          bestseller,
        })
        onDone()
      } catch (err) {
        console.error('编辑商品失败:', err)
      }
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500">{t('productName')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500">{t('price')}</span>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500">{t('unit')}</span>
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            list="unit-options-edit"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500">{t('category')}</span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Phở / Đồ uống"
            list="category-options-edit"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500">{t('emoji')}</span>
          <input
            type="text"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            list="emoji-options-edit"
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
      </div>
      <datalist id="unit-options-edit">
        {UNIT_OPTIONS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="category-options-edit">
        {CATEGORY_OPTIONS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="emoji-options-edit">
        {EMOJI_OPTIONS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500">{t('image')}</span>
        <input
          type="text"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="https://…"
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
        <div className="mt-1 flex items-center gap-2">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPickImage}
            disabled={uploading}
            className="text-xs"
          />
          {uploading && <span className="text-xs text-zinc-400">{t('uploading')}</span>}
        </div>
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            className="mt-2 h-16 w-16 rounded-lg object-cover"
          />
        )}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500">{t('nameZh')}</span>
          <input
            type="text"
            value={nameZh}
            onChange={(e) => setNameZh(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500">{t('nameEn')}</span>
          <input
            type="text"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500">{t('descVi')}</span>
        <input
          type="text"
          value={descVi}
          onChange={(e) => setDescVi(e.target.value)}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500">{t('descZh')}</span>
        <input
          type="text"
          value={descZh}
          onChange={(e) => setDescZh(e.target.value)}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500">{t('descEn')}</span>
        <input
          type="text"
          value={descEn}
          onChange={(e) => setDescEn(e.target.value)}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500">{t('extras')}</span>
        <textarea
          value={extrasText}
          onChange={(e) => setExtrasText(e.target.value)}
          rows={3}
          placeholder={t('extrasHint')}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500">{t('optionGroups')}</span>
        <textarea
          value={optionGroupsText}
          onChange={(e) => setOptionGroupsText(e.target.value)}
          rows={3}
          placeholder={t('optionGroupsHint')}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500">{t('combo')}</span>
        <textarea
          value={comboText}
          onChange={(e) => setComboText(e.target.value)}
          rows={2}
          placeholder={t('comboHint')}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={bestseller}
          onChange={(e) => setBestseller(e.target.checked)}
        />
        <span className="text-zinc-500">🔥 {t('bestseller')}</span>
      </label>

      {/* 预览：客户视角的商品卡片（保存前确认效果） */}
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-2 dark:border-amber-800 dark:bg-amber-950/20">
        <p className="mb-1.5 text-xs font-semibold text-zinc-500">{t('preview')}</p>
        <div className="flex items-center gap-2">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="h-12 w-12 rounded-lg object-cover" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-100 text-xl dark:bg-zinc-800">
              {emoji || '🍽️'}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{name}</div>
            {descVi && <p className="line-clamp-1 text-xs text-zinc-500">{descVi}</p>}
            <div className="text-sm font-semibold text-amber-600 dark:text-amber-500">
              {formatPrice(Number(price) || 0)}đ
              {unit ? ` / ${unit}` : ''}
            </div>
          </div>
        </div>
        {previewExtras(extrasText).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {previewExtras(extrasText).map((ex, i) => (
              <span
                key={i}
                className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                {ex.name}
                {ex.price > 0 ? ` +${formatPrice(ex.price)}đ` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-amber-500 px-3 py-2 text-sm text-white transition-colors hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-500 dark:text-white"
        >
          {t('save')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  )
}
