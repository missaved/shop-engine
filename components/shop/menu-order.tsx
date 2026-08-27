'use client'

import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { createOrder, callWaiter } from '@/lib/shop-actions'
import { formatPrice } from '@/lib/format'
import { LocaleSwitcher } from '@/components/locale-switcher'

// 菜单商品序列化类型（server component 已把 Decimal/可空字段转基础类型）
export type MenuProduct = {
  id: string
  name: string
  price: string
  unit: string | null
  image: string
  emoji: string
  desc: string
  category: string | null
  extras: { name: string; price: string }[]
  // 规格组（单选，选项可加价）：辣度/葱花香菜/汤底等
  optionGroups: {
    name: string
    required: boolean
    options: { name: string; price: string }[]
  }[]
  combo: { name: string; qty: number }[]
  bestseller: boolean
}

type OrderType = 'dine_in' | 'takeaway' | 'delivery'

// 幂等键：需唯一即可（防双击），不需密码学强度；crypto.randomUUID 在 HTTP 局域网非 secure context 下不可用，故加 fallback
function genIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// 读取客户手机号 cookie（下单后记住，下次访问自动预填，免手动输入）
function readPhoneCookie(): string {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(/(?:^|;\s*)customer_phone=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

// 游客标识：读取或生成 guestKey（存 cookie，1 年），下单/查单用它锁定本人订单（免填订单号）
function ensureGuestKey(): string {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(/(?:^|;\s*)guest_key=([^;]*)/)
  if (m) return decodeURIComponent(m[1])
  const key =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  document.cookie = `guest_key=${encodeURIComponent(key)}; max-age=31536000; path=/; SameSite=Lax`
  return key
}

// 客户侧点单表单：逐项加减数量 + 加料 + 点单类型 + 手机号 + 一键下单
export function MenuOrder({
  slug,
  shopName,
  shopDesc,
  open,
  minOrderAmount,
  deliveryFee,
  packingFee,
  deliveryArea,
  products,
}: {
  slug: string
  shopName: string
  shopDesc: string
  open: boolean
  minOrderAmount: number
  deliveryFee: number
  packingFee: number
  deliveryArea: string
  products: MenuProduct[]
}) {
  const t = useTranslations('menu')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [extras, setExtras] = useState<Record<string, string[]>>({})
  const [orderType, setOrderType] = useState<OrderType>('dine_in')
  // 欢迎页：首次打开先选用餐方式 + 看店面介绍，选完才进菜单
  const [selected, setSelected] = useState(false)
  const [tableNo, setTableNo] = useState('')
  const [address, setAddress] = useState('')
  const [packing, setPacking] = useState(false) // 堂食打包（收打包费）
  const [pickup, setPickup] = useState(false) // 外送自取（免配送费）
  const [phone, setPhone] = useState(() => readPhoneCookie())
  const [note, setNote] = useState('')
  const [done, setDone] = useState<{ orderNo: number; displayNo: string } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [callSent, setCallSent] = useState(false) // 呼叫服务员成功提示
  const [cartOpen, setCartOpen] = useState(false)
  // 规格选择：productId -> { 规格组名 -> 选中选项名 }（单选）
  const [options, setOptions] = useState<Record<string, Record<string, string>>>({})
  // 加购抽屉当前商品（null = 关闭）
  const [activeProduct, setActiveProduct] = useState<MenuProduct | null>(null)
  const [pending, startTransition] = useTransition()
  // P0-7 幂等键：同一次「下单意图」复用同一键，防双击/重放重复建单；成功后换新键
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    genIdempotencyKey(),
  )
  // 游客标识（cookie）：下单/查单凭证，锁定本人订单
  const [guestKey] = useState<string>(() => ensureGuestKey())

  // 商品小计：商品价 + 加料价 + 规格价（按份计）
  const subtotal = products.reduce((sum, p) => {
    const n = qty[p.id] ?? 0
    const extrasSum = (extras[p.id] ?? []).reduce((s, name) => {
      const ex = p.extras.find((e) => e.name === name)
      return s + (ex ? Number(ex.price) : 0)
    }, 0)
    // 规格价：每组选中选项的加价之和
    const optsSum = p.optionGroups.reduce((s, g) => {
      const chosen = (options[p.id] ?? {})[g.name]
      const opt = g.options.find((o) => o.name === chosen)
      return s + (opt ? Number(opt.price) : 0)
    }, 0)
    return sum + (Number(p.price) + extrasSum + optsSum) * n
  }, 0)
  // 配送费：仅外送（非自取）；打包费：堂食打包。应付合计 = 商品小计 + 费用
  const deliveryCharge = orderType === 'delivery' && !pickup ? deliveryFee : 0
  const packingCharge = orderType === 'dine_in' && packing ? packingFee : 0
  const fee = deliveryCharge + packingCharge
  const total = subtotal + fee
  // 购物车明细：已选商品列表 + 总件数（问题 2 明细预览）
  const cartItems = products.filter((p) => (qty[p.id] ?? 0) > 0)
  const cartCount = cartItems.reduce((sum, p) => sum + (qty[p.id] ?? 0), 0)

  function setQ(id: string, n: number) {
    setQty((prev) => ({ ...prev, [id]: Math.max(0, n) }))
  }

  // 加购抽屉「加入购物车」回调：累加数量 + 覆盖该商品规格/加料
  function addFromSheet(
    productId: string,
    n: number,
    selExtras: string[],
    selOptions: Record<string, string>,
  ) {
    setQty((prev) => ({ ...prev, [productId]: (prev[productId] ?? 0) + n }))
    setExtras((prev) => ({ ...prev, [productId]: selExtras }))
    setOptions((prev) => ({ ...prev, [productId]: selOptions }))
    setActiveProduct(null)
  }

  // 客户侧订单摘要（复制用）
  function buildSummary(displayNo: string): string {
    const lines = [
      `🏪 ${shopName}`,
      `${t('orderNo')} ${displayNo}`,
      ...products
        .filter((p) => (qty[p.id] ?? 0) > 0)
        .map((p) => {
          const comboStr = p.combo
            .map((c) => (c.qty > 1 ? `${c.name}×${c.qty}` : c.name))
            .join(', ')
          const extraStr = (extras[p.id] ?? []).map((name) => `+${name}`).join(' ')
          const optStr = Object.entries(options[p.id] ?? {})
            .map(([, v]) => v)
            .filter(Boolean)
            .join(', ')
          const detail = [comboStr, optStr, extraStr].filter(Boolean).join(' ')
          return `- ${p.name} x${qty[p.id]}${detail ? ' (' + detail + ')' : ''}`
        }),
      `${t('total')}: ${formatPrice(total)}đ`,
    ]
    return lines.join('\n')
  }

  async function copySummary(displayNo: string) {
    try {
      await navigator.clipboard.writeText(buildSummary(displayNo))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error('复制失败:', e)
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const items = products
      .filter((p) => (qty[p.id] ?? 0) > 0)
      .map((p) => ({
        productId: p.id,
        qty: qty[p.id],
        extras: extras[p.id],
        options: options[p.id],
      }))
    if (items.length === 0) return

    startTransition(async () => {
      try {
        const res = await createOrder({
          slug,
          items,
          customerPhone: phone,
          orderType,
          tableNo,
          address,
          note,
          idempotencyKey,
          packing,
          pickup,
          guestKey,
        })
        // 记住手机号 cookie（客户下次访问菜单/查单自动预填）
        if (phone.trim()) {
          document.cookie = `customer_phone=${encodeURIComponent(phone.trim())}; max-age=31536000; path=/; SameSite=Lax`
        }
        setDone(res)
        setIdempotencyKey(genIdempotencyKey()) // 下一单换新键
      } catch (err) {
        // P1-5 网络失败（断网/服务不可达）→ 友好三语文案；业务错误 → 显示服务端具体原因
        const msg = err instanceof Error ? err.message : ''
        const isNetwork = /fetch|network|failed to connect|ECONN|ERR_/i.test(msg)
        setError(isNetwork ? t('error') : msg || t('error'))
      }
    })
  }

  // 呼叫服务员：找服务员买水/买单/其他需求（传当前桌号/手机号，可为空）
  function onCallWaiter() {
    startTransition(async () => {
      try {
        await callWaiter({
          slug,
          tableNo: orderType === 'dine_in' ? tableNo : undefined,
          phone,
        })
        setCallSent(true)
        setTimeout(() => setCallSent(false), 3000)
      } catch {
        setError(t('error'))
      }
    })
  }

  // 下单成功：订单号 + 一键复制 + 查单入口（A10）
  if (done) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t('orderSuccess')}</h1>
        <p className="text-lg">
          {t('orderNo')} {done.displayNo}
        </p>
        <p className="text-sm text-zinc-500">
          {t('trackHint', { orderNo: done.displayNo, phone })}
        </p>
        <button
          onClick={() => copySummary(done.displayNo)}
          className="rounded-md bg-amber-500 px-4 py-2 text-sm text-white transition-colors hover:bg-amber-600 dark:bg-amber-500 dark:text-white"
        >
          {copied ? t('copied') : t('copySummary')}
        </button>
        <Link
          href={`/s/${slug}/track?orderNo=${done.displayNo}&phone=${encodeURIComponent(phone)}`}
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {t('trackLink')}
        </Link>
      </main>
    )
  }

  // 欢迎页：先选用餐方式（堂食/外带/外送）+ 店面介绍，选完进入菜单
  if (!selected) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{shopName}</h1>
          <div className="flex items-center gap-3">
            <LocaleSwitcher />
            {!open && (
              <span className="text-sm text-red-600 dark:text-red-400">{t('closed')}</span>
            )}
          </div>
        </div>

        <h2 className="mt-8 text-2xl font-semibold">{t('welcome')}</h2>
        {shopDesc && (
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {shopDesc}
          </p>
        )}

        <p className="mt-8 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t('chooseType')}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {(
            [
              ['dine_in', 'dineIn', '🍽️'],
              ['takeaway', 'takeaway', '🥡'],
              ['delivery', 'delivery', '🛵'],
            ] as const
          ).map(([value, key, emoji]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setOrderType(value)
                setSelected(true)
              }}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-4 text-left shadow-sm transition-transform active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="text-2xl">{emoji}</span>
              <span className="flex-1 text-base font-medium">{t(key)}</span>
              <span className="text-zinc-300 dark:text-zinc-600">›</span>
            </button>
          ))}
        </div>
      </main>
    )
  }

  // 按分类分组（同分类归组、无分类归「其他」；分类按首次出现顺序排列）
  const groups: { name: string | null; items: MenuProduct[] }[] = []
  for (const p of products) {
    const g = groups.find((x) => x.name === p.category)
    if (g) g.items.push(p)
    else groups.push({ name: p.category ?? null, items: [p] })
  }
  // 热卖商品在各自分类内置顶（sort 稳定，其余保持录入顺序）
  for (const g of groups) {
    g.items.sort((a, b) => (b.bestseller ? 1 : 0) - (a.bestseller ? 1 : 0))
  }

  if (products.length === 0) {
    return <p className="px-6 py-16 text-center text-zinc-500">{t('empty')}</p>
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-32">
      {/* 店头 + 语言切换（自动切换由 middleware 处理，这里供手动切换） */}
      <div className="flex items-center justify-between py-4">
        <h1 className="text-xl font-semibold">{shopName}</h1>
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          {!open && (
            <span className="text-sm text-red-600 dark:text-red-400">{t('closed')}</span>
          )}
        </div>
      </div>

      {/* 当前用餐方式：点按返回欢迎页重选（打烊也可见，保证能返回） */}
      <button
        type="button"
        onClick={() => setSelected(false)}
        className="mb-1 flex items-center gap-1 self-start rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        ↩ {t(orderType === 'dine_in' ? 'dineIn' : orderType === 'takeaway' ? 'takeaway' : 'delivery')}
      </button>

      {/* 呼叫服务员：客户随时找服务员（买水/买单/其他需求），老板端冒泡 + 声音 */}
      {open && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCallWaiter}
            disabled={pending}
            className="flex-1 rounded-md border border-amber-300 px-3 py-2 text-sm text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-60 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
          >
            🔔 {t('callWaiter')}
          </button>
          {callSent && <span className="text-xs text-green-600 dark:text-green-400">{t('callWaiterSent')}</span>}
        </div>
      )}

      {/* 商品列表（按分类分组） */}
      {groups.map((g) => (
        <div key={g.name ?? '__others'}>
          <h2 className="mt-4 mb-2 text-sm font-semibold text-zinc-500">
            {g.name ?? t('othersCategory')}
          </h2>
          <ul className="grid grid-cols-2 gap-3">
            {g.items.map((p) => {
              const n = qty[p.id] ?? 0
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setActiveProduct(p)}
                    className="relative flex w-full flex-col overflow-hidden rounded-xl border border-zinc-100 bg-white text-left shadow-sm transition-transform active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image}
                        alt={p.name}
                        className="h-24 w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-24 w-full items-center justify-center bg-zinc-50 text-4xl dark:bg-zinc-800">
                        {p.emoji}
                      </span>
                    )}
                    {n > 0 && (
                      <span className="absolute right-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-500 px-1 text-xs font-semibold text-white">
                        {n}
                      </span>
                    )}
                    <div className="flex flex-1 flex-col p-2.5">
                      <div className="flex items-start gap-1">
                        <span className="line-clamp-2 text-sm font-medium leading-snug">
                          {p.name}
                        </span>
                        {p.bestseller && <span className="shrink-0 text-[10px]">🔥</span>}
                      </div>
                      <div className="mt-auto pt-1 text-sm font-semibold text-amber-600 dark:text-amber-500">
                        {formatPrice(Number(p.price))}đ
                        {p.unit ? (
                          <span className="text-xs font-normal text-zinc-400"> / {p.unit}</span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {/* 悬浮购物车栏（问题 2）：已选商品时显示 */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-3">
          <button
            onClick={() => setCartOpen(true)}
            className="mx-auto flex w-full max-w-md items-center justify-between rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 text-white shadow-lg shadow-amber-500/30 active:scale-[0.99] dark:from-amber-500 dark:to-orange-500"
          >
            <span className="text-sm font-semibold">
              {t('cart')} · {cartCount}
            </span>
            <span className="flex items-center gap-2">
              {orderType === 'delivery' && minOrderAmount > 0 && subtotal < minOrderAmount ? (
                <span className="text-[11px] opacity-80">
                  {t('minOrderHint', {
                    amount: formatPrice(minOrderAmount - subtotal),
                  })}
                </span>
              ) : null}
              <span className="font-bold">{formatPrice(total)}đ</span>
            </span>
          </button>
        </div>
      )}

      {/* 购物车抽屉（问题 2）：明细 + 下单操作收口 */}
      {cartOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in"
          onClick={() => setCartOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md animate-slide-up flex-col rounded-t-2xl bg-white dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 抽屉头 */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
              <h3 className="font-semibold">
                {t('cart')} ({cartCount})
              </h3>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="text-xl leading-none text-zinc-400"
                aria-label="close"
              >
                ×
              </button>
            </div>

            {/* 明细列表 */}
            <div className="flex-1 overflow-y-auto px-5">
              {cartItems.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-400">{t('cartEmpty')}</p>
              ) : (
                cartItems.map((p) => {
                  const n = qty[p.id] ?? 0
                  const exNames = extras[p.id] ?? []
                  const extrasSum = exNames.reduce((s, name) => {
                    const ex = p.extras.find((e) => e.name === name)
                    return s + (ex ? Number(ex.price) : 0)
                  }, 0)
                  const chosenOpts = Object.entries(options[p.id] ?? {})
                    .map(([, v]) => v)
                    .filter(Boolean)
                  const optsSum = p.optionGroups.reduce((s, g) => {
                    const chosen = (options[p.id] ?? {})[g.name]
                    const opt = g.options.find((o) => o.name === chosen)
                    return s + (opt ? Number(opt.price) : 0)
                  }, 0)
                  const lineTotal = (Number(p.price) + extrasSum + optsSum) * n
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 border-b border-zinc-100 py-3 last:border-b-0 dark:border-zinc-800"
                    >
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image}
                          alt={p.name}
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xl dark:bg-zinc-800">
                          {p.emoji}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        {chosenOpts.length > 0 && (
                          <div className="truncate text-xs text-zinc-500">
                            {chosenOpts.join(', ')}
                          </div>
                        )}
                        {exNames.length > 0 && (
                          <div className="truncate text-xs text-zinc-500">
                            {exNames.map((nm) => `+${nm}`).join(' ')}
                          </div>
                        )}
                        {p.combo.length > 0 && (
                          <div className="truncate text-xs text-zinc-500">
                            {p.combo
                              .map((c) => (c.qty > 1 ? `${c.name}×${c.qty}` : c.name))
                              .join(', ')}
                          </div>
                        )}
                        <div className="mt-0.5 text-sm font-semibold">
                          {formatPrice(lineTotal)}đ
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setQ(p.id, n - 1)}
                          className="h-8 w-8 rounded-full border border-zinc-300 text-sm dark:border-zinc-700"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm tabular-nums">{n}</span>
                        <button
                          type="button"
                          onClick={() => setQ(p.id, n + 1)}
                          className="h-8 w-8 rounded-full border border-zinc-300 text-sm dark:border-zinc-700"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* 底部：下单表单 */}
            <form
              onSubmit={onSubmit}
              className="flex flex-col gap-3 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800"
            >
              {orderType === 'dine_in' && (
                <>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">{t('tableNo')}</span>
                    <input
                      type="text"
                      value={tableNo}
                      onChange={(e) => setTableNo(e.target.value)}
                      placeholder="Bàn 5"
                      className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={packing}
                      onChange={(e) => setPacking(e.target.checked)}
                    />
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {t('packing')}
                      {packingFee > 0 ? ` (+${formatPrice(packingFee)}đ)` : ''}
                    </span>
                  </label>
                </>
              )}
              {orderType === 'delivery' && (
                <>
                  {deliveryArea && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      📍 {t('deliveryArea')}: {deliveryArea}
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={pickup}
                      onChange={(e) => setPickup(e.target.checked)}
                    />
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {t('pickup')} ({t('noDeliveryFee')})
                    </span>
                  </label>
                  {!pickup && (
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">{t('address')}</span>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="12 Nguyễn Huệ, P.5"
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                      />
                    </label>
                  )}
                </>
              )}

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {t('phone')}
                  {orderType === 'delivery' && !pickup ? (
                    <span className="text-red-500"> *</span>
                  ) : (
                    <span className="text-zinc-400"> ({t('optional')})</span>
                  )}
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('phonePlaceholder')}
                  required={orderType === 'delivery' && !pickup}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">{t('note')}</span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('notePlaceholder')}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </label>

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {t('total')}: {formatPrice(total)}đ
                  {deliveryCharge > 0 && (
                    <span className="text-zinc-400 dark:text-zinc-500">
                      {' '}({t('deliveryFee')} {formatPrice(deliveryCharge)}đ)
                    </span>
                  )}
                  {packingCharge > 0 && (
                    <span className="text-zinc-400 dark:text-zinc-500">
                      {' '}({t('packingFee')} {formatPrice(packingCharge)}đ)
                    </span>
                  )}
                  {orderType === 'delivery' && !pickup && minOrderAmount > 0 && subtotal < minOrderAmount
                    ? ` · ${t('minOrderHint', {
                        amount: formatPrice(minOrderAmount - subtotal),
                      })}`
                    : ''}
                </span>
                <button
                  type="submit"
                  disabled={
                    !open ||
                    pending ||
                    subtotal === 0 ||
                    (orderType === 'delivery' && !pickup && minOrderAmount > 0 && subtotal < minOrderAmount)
                  }
                  className="rounded-md bg-amber-500 px-5 py-2 text-sm text-white transition-colors hover:bg-amber-600 disabled:opacity-50 dark:bg-amber-500 dark:text-white"
                >
                  {pending ? '…' : t('submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 加购抽屉（问题 1）：选规格/加料/数量 → 加入购物车 */}
      <AddToCartSheet
        product={activeProduct}
        onClose={() => setActiveProduct(null)}
        onAdd={addFromSheet}
      />
    </div>
  )
}

// 加购抽屉（问题 1）：点商品弹出，选规格组（单选）/加料（多选）/数量 → 加入购物车
function AddToCartSheet({
  product,
  onClose,
  onAdd,
}: {
  product: MenuProduct | null
  onClose: () => void
  onAdd: (
    productId: string,
    qty: number,
    extras: string[],
    options: Record<string, string>,
  ) => void
}) {
  const t = useTranslations('menu')
  const [qty, setQty] = useState(1)
  const [selExtras, setSelExtras] = useState<string[]>([])
  const [selOptions, setSelOptions] = useState<Record<string, string>>({})

  // 商品切换时重置：required 规格组默认选第一个选项
  useEffect(() => {
    if (product) {
      setQty(1)
      setSelExtras([])
      const init: Record<string, string> = {}
      for (const g of product.optionGroups) {
        if (g.required && g.options.length > 0) init[g.name] = g.options[0].name
      }
      setSelOptions(init)
    }
  }, [product])

  if (!product) return null

  // 规格价 + 加料价 → 单项合计
  const optsSum = product.optionGroups.reduce((s, g) => {
    const chosen = selOptions[g.name]
    const opt = g.options.find((o) => o.name === chosen)
    return s + (opt ? Number(opt.price) : 0)
  }, 0)
  const extrasSum = selExtras.reduce((s, name) => {
    const ex = product.extras.find((e) => e.name === name)
    return s + (ex ? Number(ex.price) : 0)
  }, 0)
  const lineTotal = (Number(product.price) + optsSum + extrasSum) * qty

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md animate-slide-up flex-col overflow-y-auto rounded-t-2xl bg-white p-5 pb-8 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />

        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image}
            alt={product.name}
            className="h-40 w-full rounded-xl object-cover"
          />
        ) : (
          <span className="flex h-24 w-24 items-center justify-center rounded-xl bg-zinc-100 text-5xl dark:bg-zinc-800">
            {product.emoji}
          </span>
        )}
        <h3 className="mt-3 text-lg font-semibold">{product.name}</h3>
        {product.desc && (
          <p className="mt-1 text-sm leading-relaxed text-zinc-500">{product.desc}</p>
        )}

        {/* 套餐组成（combo）：展示套餐包含的商品 */}
        {product.combo.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold text-zinc-500">{t('combo')}</div>
            <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              {product.combo.map((c, i) => (
                <li key={i} className="flex justify-between">
                  <span>{c.name}</span>
                  <span className="text-zinc-400">×{c.qty}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 规格组（单选） */}
        {product.optionGroups.map((g) => (
          <div key={g.name} className="mt-4">
            <div className="mb-2 text-xs font-semibold text-zinc-500">
              {g.name}
              {g.required ? ' *' : ''}
            </div>
            <div className="flex flex-wrap gap-2">
              {g.options.map((o) => {
                const active = selOptions[g.name] === o.name
                return (
                  <button
                    key={o.name}
                    type="button"
                    onClick={() =>
                      setSelOptions((prev) => ({ ...prev, [g.name]: o.name }))
                    }
                    className={
                      active
                        ? 'rounded-full bg-amber-500 px-3 py-1.5 text-xs text-white dark:bg-amber-500 dark:text-white'
                        : 'rounded-full border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700'
                    }
                  >
                    {o.name}
                    {Number(o.price) > 0
                      ? ` +${formatPrice(Number(o.price))}đ`
                      : ''}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* 加料（多选） */}
        {product.extras.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold text-zinc-500">
              {t('extras')}
            </div>
            <div className="flex flex-wrap gap-2">
              {product.extras.map((ex) => {
                const active = selExtras.includes(ex.name)
                return (
                  <button
                    key={ex.name}
                    type="button"
                    onClick={() =>
                      setSelExtras((prev) =>
                        prev.includes(ex.name)
                          ? prev.filter((x) => x !== ex.name)
                          : [...prev, ex.name],
                      )
                    }
                    className={
                      active
                        ? 'rounded-full bg-amber-500 px-3 py-1.5 text-xs text-white dark:bg-amber-500 dark:text-white'
                        : 'rounded-full border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700'
                    }
                  >
                    {ex.name} +{formatPrice(Number(ex.price))}đ
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* 数量 + 合计 */}
        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="h-9 w-9 rounded-full border border-zinc-300 text-lg dark:border-zinc-700"
            >
              −
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => q + 1)}
              className="h-9 w-9 rounded-full border border-zinc-300 text-lg dark:border-zinc-700"
            >
              +
            </button>
          </div>
          <div className="text-lg font-bold">{formatPrice(lineTotal)}đ</div>
        </div>

        <button
          type="button"
          onClick={() => onAdd(product.id, qty, selExtras, selOptions)}
          className="mt-4 w-full rounded-full bg-amber-500 py-3 font-semibold text-white active:scale-[0.99] dark:bg-amber-500 dark:text-white"
        >
          {t('addToCart')} · {formatPrice(lineTotal)}đ
        </button>
      </div>
    </div>
  )
}
