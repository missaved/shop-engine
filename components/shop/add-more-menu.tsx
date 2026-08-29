'use client'

// 查单页「趁出餐前加一份」自助加菜区：点商品弹抽屉选规格/加料 → 暂存待确认（可增减/清空）→ 确认加菜。
// 复用 AddToCartSheet 与客户侧 addItemsToMyOrder（guestKey 锁单 + 待确认，非另一套独立逻辑）。
// 商品列表由 track 页按订单状态过滤后传入：READY（待取餐）阶段只含 canAddOn 商品。
import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { addItemsToMyOrder } from '@/lib/shop-actions'
import { formatPrice } from '@/lib/format'
import { AddToCartSheet, type MenuProduct } from './menu-order'
import type { ShopTheme } from '@/lib/theme'

// 服务端稳定错误码 → track 段本地化 key（不向客户直出中文；ORDER_NOT_FOUND 复用查单 notFound，RATE_LIMITED 复用 rateLimited）
const ERROR_KEY: Record<string, string> = {
  ORDER_NOT_FOUND: 'notFound',
  ORDER_NOT_ADDABLE: 'errAddFailed',
  ITEM_NOT_ADDABLE: 'errAddFailed',
  AMOUNT_OVER: 'errAddFailed',
  NO_ITEMS: 'errAddFailed',
  RATE_LIMITED: 'rateLimited',
  ADD_FAILED: 'errAddFailed',
}

// 待确认项：已选商品 + 数量 + 加料/规格（规格/加料沿用商品自身配置，服务端计价）
type PendingItem = {
  product: MenuProduct
  qty: number
  extras: string[]
  options: Record<string, string>
}

export function AddMoreMenu({
  slug,
  orderNo,
  phone,
  guestKey,
  currency,
  theme,
  products,
  orderStatus,
}: {
  slug: string
  orderNo: string
  phone: string
  guestKey?: string
  currency: string
  theme: ShopTheme
  products: MenuProduct[]
  orderStatus: string
}) {
  const t = useTranslations('track')
  const router = useRouter()
  // 待确认列表：点「+」只暂存（不直接入单），可增减/清空，确认后才调 addItemsToMyOrder
  const [pending, setPending] = useState<PendingItem[]>([])
  // 加购抽屉当前商品（复用选规格/加料）
  const [activeProduct, setActiveProduct] = useState<MenuProduct | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // M6 双击防护：同步锁（useTransition pending 是旧闭包，双击会双加）
  const busyRef = useRef(false)

  // 从抽屉「加入待确认」：同商品累加数量并覆盖规格/加料
  function addFromSheet(
    productId: string,
    qty: number,
    extras: string[],
    options: Record<string, string>,
  ) {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    setPending((prev) => {
      const idx = prev.findIndex((it) => it.product.id === productId)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + qty, extras, options }
        return next
      }
      return [...prev, { product, qty, extras, options }]
    })
    setActiveProduct(null)
  }

  // 待确认项步进（减到 0 移除）
  function bump(idx: number, delta: number) {
    setPending((prev) =>
      prev
        .map((it, i) => (i === idx ? { ...it, qty: it.qty + delta } : it))
        .filter((it) => it.qty > 0),
    )
  }

  function clearPending() {
    if (busyRef.current) return
    setPending([])
    setError(null)
    setFeedback(null)
  }

  // 待确认合计（新增 subtotal，供「确认加菜」栏显示）
  const pendingCount = pending.reduce((s, it) => s + it.qty, 0)
  const pendingSubtotal = pending.reduce((s, it) => {
    const extrasSum = it.extras.reduce((ss, name) => {
      const ex = it.product.extras.find((e) => e.name === name)
      return ss + (ex ? Number(ex.price) : 0)
    }, 0)
    const optsSum = it.product.optionGroups.reduce((ss, g) => {
      const chosen = it.options[g.name]
      const opt = g.options.find((o) => o.name === chosen)
      return ss + (opt ? Number(opt.price) : 0)
    }, 0)
    return s + (Number(it.product.price) + extrasSum + optsSum) * it.qty
  }, 0)

  // 确认加菜：调客户侧 addItemsToMyOrder（guestKey 锁单 + 服务端计价 + FOOD_ADD 待办）
  async function confirmAdd() {
    if (pending.length === 0) return
    if (busyRef.current) return
    busyRef.current = true
    setSubmitting(true)
    setError(null)
    setFeedback(null)
    try {
      const items = pending.map((it) => ({
        productId: it.product.id,
        qty: it.qty,
        extras: it.extras.length > 0 ? it.extras : undefined,
        options: Object.keys(it.options).length > 0 ? it.options : undefined,
      }))
      const res = await addItemsToMyOrder({ slug, orderNo, items, phone, guestKey })
      setPending([])
      setFeedback(t('added', { orderNo: res.displayNo }))
      router.refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setError(t(ERROR_KEY[msg] ?? 'errAddFailed'))
    } finally {
      busyRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-fg theme-${theme}`}
    >
      <div className="flex flex-col items-center gap-1.5">
        <h3 className="text-center text-lg font-semibold">{t('addMore')}</h3>
        {orderStatus === 'READY' && (
          <span className="shrink-0 rounded-full bg-soft px-2 py-0.5 text-xs text-sub">
            {t('readyAddHint')}
          </span>
        )}
      </div>

      {/* 可加商品网格：点「+」弹抽屉选规格/加料 → 暂存待确认（不直接入单）。
          2026-08-29 用户需求：加菜显示与点单一致（大图卡片，不用缩略图），复用点单卡片结构 */}
      {products.length === 0 ? (
        <p className="py-6 text-center text-sm text-sub">{t('noAddable')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5">
          {products.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setActiveProduct(p)}
                className="relative flex w-full flex-col overflow-hidden rounded-[var(--theme-radius-card)] border border-line bg-surface text-left shadow-sm transition-transform active:scale-[0.98]"
              >
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image} alt={p.name} className="h-24 w-full object-cover" />
                ) : (
                  <span className="flex h-24 w-full items-center justify-center bg-tile text-4xl">
                    {p.emoji}
                  </span>
                )}
                <div className="flex flex-1 flex-col p-2">
                  <div className="flex items-start gap-1">
                    <span className="line-clamp-2 text-sm font-medium leading-snug">
                      {p.name}
                    </span>
                    {p.bestseller && (
                      <span className="shrink-0 rounded bg-red-50 px-1 py-0.5 text-[10px] font-medium leading-none text-red-600 dark:bg-red-950 dark:text-red-400">
                        {t('bestseller')}
                      </span>
                    )}
                  </div>
                  <div className="mt-auto pt-1 text-sm font-semibold text-primary">
                    {formatPrice(Number(p.price), currency)}
                    {p.unit ? (
                      <span className="text-xs font-normal text-sub"> / {p.unit}</span>
                    ) : null}
                  </div>
                </div>
                <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-fg">
                  +
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 待确认列表：主色描边 + 数量步进（可减到移除） */}
      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          {pending.map((it, idx) => (
            <div
              key={it.product.id}
              className="flex items-center gap-2 rounded-lg border-2 border-primary bg-soft p-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {it.product.name} ×{it.qty}
              </span>
              <button
                type="button"
                onClick={() => bump(idx, -1)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-sm"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => bump(idx, 1)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-sm"
              >
                +
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 待确认栏：新增合计 + 清空 + 确认加菜 */}
      {pending.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-tile p-3">
          <div className="min-w-0">
            <div className="text-xs text-sub">{t('pendingItems', { n: pendingCount })}</div>
            <div className="text-sm font-semibold">
              {t('addSubtotal')}: {formatPrice(pendingSubtotal, currency)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={clearPending}
              disabled={submitting}
              className="rounded-md border border-line px-4 py-2.5 text-lg text-sub disabled:opacity-50"
            >
              {t('clear')}
            </button>
            <button
              type="button"
              onClick={confirmAdd}
              disabled={submitting}
              className="rounded-[var(--theme-radius-btn)] bg-gradient-to-r from-primary to-primary-hover px-5 py-2.5 text-lg font-semibold text-primary-fg disabled:opacity-50"
            >
              {submitting ? '…' : t('confirmAdd')}
            </button>
          </div>
        </div>
      )}

      {/* 反馈用主题 token（bg-primary/text-primary-fg），不复用 dashboard ToastView（硬编码 amber） */}
      {feedback && (
        <p className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-fg">
          {feedback}
        </p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* 加购抽屉：选规格/加料/数量 → 加入待确认 */}
      <AddToCartSheet
        product={activeProduct}
        currency={currency}
        onClose={() => setActiveProduct(null)}
        onAdd={addFromSheet}
      />
    </section>
  )
}
