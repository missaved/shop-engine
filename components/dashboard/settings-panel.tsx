'use client'

import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  createProduct,
  reorderProducts,
  searchOrderHistory,
  toggleProductActive,
  toggleShopOpen,
  updateProduct,
  updateShopSettings,
  type HistoryOrderRow,
} from '@/lib/actions'
import type { ShopPlain } from './order-list'
import { useToast, ToastView } from './use-toast'
import { TableQrGenerator } from './table-qr-generator'
import { formatPrice } from '@/lib/format'
import { THEMES, THEME_LABELS, normalizeTheme, type ShopTheme } from '@/lib/theme'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { RevenueCard } from './revenue-card'
import { PresetOnboarding, type PresetOption } from './preset-onboarding'
import type { DraftItem } from '@/lib/preset-actions'

// 订单状态 → dashboard 段文案 key（历史订单结果展示用）
const STATUS_KEY: Record<string, string> = {
  PENDING: 'statusPending',
  IN_PROGRESS: 'statusInProgress',
  READY: 'statusReady',
  COMPLETED: 'statusCompleted',
  CANCELLED: 'statusCancelled',
}

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
  // 出餐后可追加（READY 阶段客户加菜仅限此商品，默认 true）
  canAddOn: boolean
}

// 老板侧设置：营业开关 / 商品售罄 / 营业时间 / 起送价
export function SettingsPanel({
  products,
  shop,
  onLogout,
  // 营业额/今日统计（从首页移入设置，用户反馈：不要挤占 boss 首页）
  todayRevenue = 0,
  revenue3d = 0,
  revenue7d = 0,
  revenue30d = 0,
  todayCount = 0,
  count3 = 0,
  count7 = 0,
  count30 = 0,
  presets = [],
  draftItems = [],
  hasSnapshot = false,
}: {
  products: ProductPlain[]
  shop: ShopPlain
  onLogout?: () => Promise<void>
  todayRevenue?: number
  revenue3d?: number
  revenue7d?: number
  revenue30d?: number
  todayCount?: number
  count3?: number
  count7?: number
  count30?: number
  presets?: PresetOption[] // AI 预设库选项（服务端传入）
  draftItems?: DraftItem[] // ShopDraft 草稿（服务端传入）
  hasSnapshot?: boolean // 有覆盖前快照可还原
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
  // 店面介绍·中文/英文（2026-08-29 语种混杂修复：客户端按 locale 展示对应语言，主 description 仍为默认语）
  const [descriptionZh, setDescriptionZh] = useState<string>(
    shop.config?.descriptionZh ?? '',
  )
  const [descriptionEn, setDescriptionEn] = useState<string>(
    shop.config?.descriptionEn ?? '',
  )
  const [theme, setTheme] = useState<ShopTheme>(
    () => normalizeTheme(shop.config?.theme ?? 'warm'),
  )
  const [saved, setSaved] = useState(false)
  // 账户授权信息面板 + 退出登录确认（内容流末尾，随内容滑动，不吸底）
  const [accountOpen, setAccountOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Issue10：历史订单查找（单号/手机号模糊搜最近 90 天，只读快照）
  const [histQuery, setHistQuery] = useState('')
  const [histRows, setHistRows] = useState<HistoryOrderRow[]>([])
  const [histSearched, setHistSearched] = useState(false)
  const [histSearching, startHistSearch] = useTransition()
  // 历史订单默认折叠（用户反馈：折叠流出查询订单位置；账户授权/退出登录永远最底）
  const [histOpen, setHistOpen] = useState(false)
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

  // Issue10：历史订单查找（单号/手机号模糊搜，默认最近 90 天）
  function searchHistory() {
    startHistSearch(async () => {
      try {
        const rows = await searchOrderHistory({ query: histQuery, days: 90 })
        setHistRows(rows)
        setHistSearched(true)
      } catch (e) {
        console.error('历史订单查询失败:', e)
        show(t('toastError'))
      }
    })
  }

  // 商品渲染顺序：上架在前、未上架（售罄）靠后（用户反馈：下架的排下面，位置固定不跳）；
  // 组内保持服务端保存顺序。toggle 售罄时商品在前/后组间明确移动，组内不再跳来跳去。
  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => Number(b.active) - Number(a.active)),
    [products],
  )

  // 上移/下移：按当前渲染视图（上架在前）交换相邻商品后整表重排 sortOrder（dir：-1 上移，+1 下移）
  function moveProduct(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= sortedProducts.length) return
    const next = [...sortedProducts]
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
      descriptionZh,
      descriptionEn,
      theme,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    router.refresh()
  }

  return (
    <section className="flex flex-col gap-4">
      {/* 语言切换（从 dashboard 侧栏移入设置，图标+弹出） */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-sm font-medium">{t('language')}</span>
        <LocaleSwitcher />
      </div>

      {/* 营业概览：营业额 + 今日订单（从首页移入设置，用户反馈：不要挤占 boss 首页） */}
      <RevenueCard
        day1={todayRevenue}
        day3={revenue3d}
        day7={revenue7d}
        day30={revenue30d}
        count1={todayCount}
        count3={count3}
        count7={count7}
        count30={count30}
        currency={shop.currency}
      />

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

      {/* AI 预设上架（第 19 批 A6：勾选子分类 → 草稿 → 一键上架；追加模式 2026-08-29 不清空现有商品，旧快照可还原） */}
      <PresetOnboarding
        presets={presets}
        draftItems={draftItems}
        hasSnapshot={hasSnapshot}
        currency={shop.currency}
      />

      {/* 商品管理：售罄 / 编辑 */}
      <div className="flex flex-col gap-2">
        {sortedProducts.map((p, index) => (
          <div
            key={p.id}
            className="flex flex-col rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">{p.emoji}</span>
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-sm text-zinc-500">
                  {formatPrice(Number(p.price), shop.currency)}
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
                  disabled={index === sortedProducts.length - 1 || pending}
                  aria-label="下移"
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  ↓
                </button>
                <button
                  onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                  aria-label={t('edit')}
                  title={t('edit')}
                  className={`rounded-md border p-2 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 ${
                    editingId === p.id
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    <path d="m15 5 4 4" />
                  </svg>
                </button>
                <button
                  onClick={() => run(() => toggleProductActive(p.id))}
                  disabled={pending}
                  aria-label={p.active ? t('onSale') : t('soldOut')}
                  title={p.active ? t('onSale') : t('soldOut')}
                  className={
                    p.active
                      ? 'rounded-md border border-green-200 bg-green-50 p-2 text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50 dark:border-green-900/50 dark:bg-green-900/30 dark:text-green-300'
                      : 'rounded-md border border-red-200 bg-red-50 p-2 text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-900/30 dark:text-red-300'
                  }
                >
                  {p.active ? (
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="m4.9 4.9 14.2 14.2" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {editingId === p.id && (
              <div className="px-4 pb-4">
                <EditProductForm
                  product={p}
                  onDone={() => setEditingId(null)}
                  currency={shop.currency}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <AddProductForm currency={shop.currency} onAdded={() => router.refresh()} />

      {/* 桌号引导图 / 门头二维码：老板输入桌号预览，下载二维码打印贴桌 */}
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t('tableQr')}</h2>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <TableQrGenerator vertical={shop.vertical} slug={shop.slug} shopName={shop.name} city={shop.city} />
        </div>
      </div>

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

        {/* 店面介绍·中文/英文（2026-08-29 语种混杂修复：客户端按浏览语种展示，不填则回退主 description） */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {t('shopDescZh')}
          </span>
          <textarea
            value={descriptionZh}
            onChange={(e) => setDescriptionZh(e.target.value)}
            rows={2}
            placeholder="传统牛肉河粉，骨头汤熬 12 小时，每天早上新鲜制粉…"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {t('shopDescEn')}
          </span>
          <textarea
            value={descriptionEn}
            onChange={(e) => setDescriptionEn(e.target.value)}
            rows={2}
            placeholder="Traditional beef pho, 12-hour slow-simmered bone broth…"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>

        {/* 门面皮肤：客户菜单整体换肤，老板「看图挑」（每张卡自带 theme-<v> 渲染小样） */}
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {t('themeLabel')}
          </span>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setTheme(v)}
                data-od-id={`theme-card-${v}`}
                className={`theme-${v} rounded-lg border px-2 py-2 text-left text-xs transition-colors ${
                  theme === v
                    ? 'border-primary bg-primary text-primary-fg'
                    : 'bg-surface border-line text-fg hover:bg-soft'
                }`}
              >
                <span
                  className="block font-display text-base"
                  style={{ fontFamily: 'var(--theme-font-display)' }}
                >
                  Phở 88
                </span>
                <span className="mt-1 block text-[10px] opacity-85">
                  {t(THEME_LABELS[v])}
                </span>
                <span className="mt-2 block rounded-[var(--theme-radius-btn)] bg-primary py-1 text-center text-[10px] font-semibold text-primary-fg">
                  {t('themeSampleOrder')}
                </span>
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
        >
          {saved ? t('saved') : t('save')}
        </button>
      </form>

      {/* 历史订单：默认折叠（用户反馈：折叠后流出查询订单位置；账户授权/退出登录永远最底） */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => setHistOpen((o) => !o)}
          aria-expanded={histOpen}
          className="flex w-full items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          <span className="font-medium">{t('historyOrders')}</span>
          <span className="text-zinc-400">{histOpen ? '▾' : '▸'}</span>
        </button>
        {histOpen && (
          <div className="flex flex-col gap-3 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            {/* 查询控件：单号/手机号模糊搜最近 90 天（只读快照） */}
            <div className="flex gap-2">
              <input
                type="text"
                value={histQuery}
                onChange={(e) => setHistQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchHistory()}
                placeholder={t('searchPlaceholder')}
                className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
              <button
                type="button"
                onClick={searchHistory}
                disabled={histSearching}
                className="shrink-0 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
              >
                {histSearching ? '…' : t('historySearch')}
              </button>
            </div>

            {/* 查询结果（在查询控件下面流出，用户反馈） */}
            {histSearched &&
              (histRows.length === 0 ? (
                <p className="text-sm text-zinc-500">{t('noMatch')}</p>
              ) : (
                <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
                  {histRows.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="font-medium">{r.displayNo}</span>
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {t(STATUS_KEY[r.status] ?? 'statusPending')}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-zinc-400">
                        {new Date(r.createdAt).toLocaleString()}
                      </span>
                      <span className="shrink-0 font-medium">
                        {formatPrice(Number(r.total), shop.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* 账户与授权：点击弹出信息面板（内容流末尾，随内容滑动，不吸底） */}
      <button
        type="button"
        onClick={() => setAccountOpen(true)}
        className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        <span className="font-medium">{t('accountAuth')}</span>
        <span className="text-zinc-400">›</span>
      </button>

      {/* 退出登录：点击弹确认（防误触），不吸底 */}
      <button
        type="button"
        onClick={() => setConfirmLogout(true)}
        disabled={pending}
        className="flex items-center justify-center rounded-xl border border-zinc-300 px-4 py-3 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {t('logout')}
      </button>

      <ToastView msg={msg} />

      {/* 账户与授权信息面板 */}
      {accountOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in"
          onClick={() => setAccountOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-8 shadow-2xl dark:bg-zinc-900"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t('accountAuth')}</h3>
              <button
                type="button"
                onClick={() => setAccountOpen(false)}
                aria-label="关闭"
                className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">{t('shopName')}</span>
                <span className="text-right font-medium">{shop.name}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">slug</span>
                <span className="text-right font-medium">{shop.slug}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">{t('shopId')}</span>
                <span className="text-right font-medium">{shop.id}</span>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* 退出登录确认弹层 */}
      {confirmLogout && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in"
          onClick={() => setConfirmLogout(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-zinc-900"
          >
            <p className="text-base font-semibold">{t('logoutConfirm')}</p>
            <p className="mt-1 text-sm text-zinc-500">{t('logoutHint')}</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={async () => {
                  setConfirmLogout(false)
                  if (onLogout) await onLogout()
                }}
                className="flex-1 rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
              >
                {t('confirmLogout')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmLogout(false)}
                className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// 新增商品表单：名称/价格/单位/图标/介绍（图片 URL 与三语名翻译留 B8）
function AddProductForm({ onAdded, currency }: { onAdded: () => void; currency: string }) {
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
  // 出餐后可追加（默认勾选，老板收窄某道菜时取消）
  const [canAddOn, setCanAddOn] = useState(true)
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
          canAddOn,
        })
        setName('')
        setCategory('')
        setExtrasText('')
        setOptionGroupsText('')
        setComboText('')
        setBestseller(false)
        setCanAddOn(true)
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
        <span className="text-zinc-600 dark:text-zinc-400">{t('bestseller')}</span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={canAddOn}
          onChange={(e) => setCanAddOn(e.target.checked)}
        />
        <span className="text-zinc-600 dark:text-zinc-400">{t('canAddOn')}</span>
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
                {formatPrice(Number(price) || 0, currency)}
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
                  {ex.price > 0 ? ` +${formatPrice(ex.price, currency)}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
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
  currency,
}: {
  product: ProductPlain
  onDone: () => void
  currency: string
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
  // 出餐后可追加（默认 true，老板编辑时可按菜品收窄）
  const [canAddOn, setCanAddOn] = useState(product.canAddOn)

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
          canAddOn,
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
        <span className="text-zinc-500">{t('bestseller')}</span>
      </label>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={canAddOn}
          onChange={(e) => setCanAddOn(e.target.checked)}
        />
        <span className="text-zinc-500">{t('canAddOn')}</span>
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
              {formatPrice(Number(price) || 0, currency)}
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
                {ex.price > 0 ? ` +${formatPrice(ex.price, currency)}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
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
