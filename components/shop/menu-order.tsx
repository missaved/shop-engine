'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { createOrder, callWaiter, addItemsToMyOrder } from '@/lib/shop-actions'
import { getGuestActiveOrder } from '@/lib/actions'
import { formatPrice } from '@/lib/format'
import { LocaleSwitcher } from '@/components/locale-switcher'
import type { ShopTheme } from '@/lib/theme'

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
  // 出餐后可追加：READY（待取餐）阶段加菜区只列 canAddOn 商品（烧烤摊取餐后加饮料/小菜）
  canAddOn: boolean
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
  expired,
  suspended,
  minOrderAmount,
  deliveryFee,
  packingFee,
  initialTableNo,
  initialOrderType,
  deliveryArea,
  theme,
  currency,
  products,
  recommended = [],
  continueOrderNo,
}: {
  slug: string
  shopName: string
  shopDesc: string
  open: boolean
  expired: boolean
  suspended: boolean
  minOrderAmount: number
  deliveryFee: number
  packingFee: number
  initialTableNo?: string
  initialOrderType?: string
  deliveryArea: string
  theme: ShopTheme
  currency: string
  products: MenuProduct[]
  recommended?: MenuProduct[]
  // 继续点菜（track 页按钮进入）：非空时提交走「加菜」合并进现有订单（不建新单）
  continueOrderNo?: string
}) {
  const t = useTranslations('menu')
  // 营业阻断三态：平台停用 > 订阅到期 > 老板打烊（优先级与 shop-list subStatus 一致）
  const blocked = suspended ? 'suspended' : expired ? 'expired' : !open ? 'closed' : null
  const canOrder = blocked === null

  // Issue7：返回菜单页自动识别匿名进行中订单（guestKey cookie）→ 顶部提示条直达查单进度
  const [guestActive, setGuestActive] = useState<string | null>(null)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const m = document.cookie.match(/(?:^|;\s*)guest_key=([^;]*)/)
    const gk = m ? decodeURIComponent(m[1]) : ''
    if (!gk) return
    let cancelled = false
    getGuestActiveOrder({ slug, guestKey: gk })
      .then((r) => {
        if (!cancelled) setGuestActive(r?.orderNo ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slug])

  // 进行中订单提示条（welcome 页与菜单列表页共用）
  const activeBanner = guestActive ? (
    <Link
      href={`/s/${slug}/track?orderNo=${guestActive}`}
      className="mb-2 block w-full rounded-[var(--theme-radius)] bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-fg shadow-md shadow-primary/20"
    >
      {t('activeOrderHint')} ▸
    </Link>
  ) : null
  const [qty, setQty] = useState<Record<string, number>>({})
  const [extras, setExtras] = useState<Record<string, string[]>>({})
  const [orderType, setOrderType] = useState<OrderType>('dine_in')
  // 欢迎页：首次打开先选用餐方式 + 看店面介绍，选完才进菜单
  // 桌号预填（扫码点餐）：initialTableNo 非空时跳过欢迎页直接进菜单（orderType 初始即 dine_in）
  // 继续点菜（?type=）：带用餐方式参数时同样直接进菜单，SSR 首帧不闪欢迎页（2026-08-29 用户需求）
  const [selected, setSelected] = useState(
    Boolean(initialTableNo?.trim()) || Boolean(initialOrderType),
  )
  const [tableNo, setTableNo] = useState(initialTableNo?.trim() ?? '')
  // 桌号选择抽屉开关（2026-08-29 用户需求：堂食非扫码进入时欢迎页强制先弹抽屉选桌号，选完才进菜单）
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [packing, setPacking] = useState(false) // 堂食打包（收打包费）
  const [pickup, setPickup] = useState(false) // 外送自取（免配送费）
  const [phone, setPhone] = useState(() => readPhoneCookie())
  const [note, setNote] = useState('')
  const [done, setDone] = useState<{ orderNo: number; displayNo: string } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  // continue 加菜模式的本地可写镜像：prop 是只读 URL 参数；订单已完结等业务拒绝时置空，
  // 让「继续加菜」失效后可正常下新单（2026-08-30 修复生产 500 时引入）
  const [continueNo, setContinueNo] = useState<string | undefined>(continueOrderNo)
  const [callSent, setCallSent] = useState(false) // 呼叫服务员成功提示
  const [callTooFrequent, setCallTooFrequent] = useState(false) // 第18批 频率限制提示
  const [callCooldown, setCallCooldown] = useState(false) // 第18批 冷却：呼叫后 60s 禁点（防连点）
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
  // 吸顶分类栏可见性（2026-08-29 用户需求）：打开点单页即固定显示（避免首屏空白），滚动中隐藏，滚动停止后重现
  const [catNavVisible, setCatNavVisible] = useState(true)
  // 一键返回顶部按钮可见性：滚动停止且滚得较深时才出现（2026-08-29 需求5）
  const [backTopVisible, setBackTopVisible] = useState(false)
  const scrollStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onScroll = () => {
      setCatNavVisible(false)
      setBackTopVisible(false)
      if (scrollStopTimer.current) clearTimeout(scrollStopTimer.current)
      // 停止滚动 200ms 后再淡入，用户浏览时保持隐藏
      scrollStopTimer.current = setTimeout(() => {
        setCatNavVisible(true)
        // 滚得足够深才出现返回顶部按钮，靠近顶部时隐藏不碍事
        if (window.scrollY > 300) setBackTopVisible(true)
      }, 200)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (scrollStopTimer.current) clearTimeout(scrollStopTimer.current)
    }
  }, [])

  // 吸顶分类栏：点击分类标签平滑滚动到对应分组标题（标题带 cat-${i} id）
  function scrollToCategory(i: number) {
    document.getElementById(`cat-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Issue10 桌号软导航：同一组件实例经客户端导航换 ?table= 时，同步预填桌号并跳过欢迎页
  useEffect(() => {
    const t0 = initialTableNo?.trim() ?? ''
    setTableNo(t0)
    // 继续点菜直达菜单：?type= 恢复用餐方式（堂食/外带/外送），无需在欢迎页重选
    if (
      initialOrderType === 'dine_in' ||
      initialOrderType === 'takeaway' ||
      initialOrderType === 'delivery'
    ) {
      setOrderType(initialOrderType)
    }
    // 带 table（扫码点餐）或 type（继续点菜）参数即跳过欢迎页直接进菜单
    if (t0 || initialOrderType) setSelected(true)
  }, [initialTableNo, initialOrderType])

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
        if (continueNo) {
          // 继续点菜：提交合并进现有订单（加菜不建新单），复用 addItemsToMyOrder
          // （服务端按 orderNo 锁单 + 计价 + 校验订单未结束/READY 阶段可追加）
          const res = await addItemsToMyOrder({ slug, orderNo: continueNo, items, phone, guestKey })
          if (!res.ok) {
            // 业务拒绝（2026-08-30）：订单已完结/不存在 → 明确提示 + 退出 continue 模式（可下新单）。
            // 走结构化结果而非 catch：生产构建下 throw 的业务码 message 被剥离 → 前端只会 500 无提示
            setCartOpen(false) // 失败后关闭购物车抽屉，让错误提示可见
            if (res.code === 'ORDER_NOT_ADDABLE' || res.code === 'ORDER_NOT_FOUND') {
              setError(t('orderClosedHint'))
              setContinueNo(undefined)
            } else {
              setError(t('error'))
            }
            return
          }
          // 记住手机号 cookie（客户下次访问菜单/查单自动预填）
          if (phone.trim()) {
            document.cookie = `customer_phone=${encodeURIComponent(phone.trim())}; max-age=31536000; path=/; SameSite=Lax`
          }
          // 加菜成功：done 视图显示「已加菜」卡；orderNo 数字占位（未新建单），displayNo = 原订单号
          setDone({ orderNo: 0, displayNo: continueNo })
        } else {
          const res = await createOrder({
            slug,
            items,
            customerPhone: phone,
            orderType,
            // Issue10 门控：非堂食不传桌号（避免误带座位号）
            tableNo: orderType === 'dine_in' ? tableNo : undefined,
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
        }
        setIdempotencyKey(genIdempotencyKey()) // 下一单换新键
      } catch (err) {
        // P1-5 网络失败（断网/服务不可达）→ 友好三语文案；业务错误 → 显示服务端具体原因
        // 继续点菜分支：服务端抛稳定错误码（ORDER_NOT_ADDABLE 等），不向客户直出，显示通用文案
        const msg = err instanceof Error ? err.message : ''
        const isNetwork = /fetch|network|failed to connect|ECONN|ERR_/i.test(msg)
        setError(isNetwork || (continueNo && /^[A-Z_]+$/.test(msg)) ? t('error') : msg || t('error'))
      }
    })
  }

  // 呼叫服务员：找服务员买水/买单/其他需求（传当前桌号/手机号，可为空）
  // 第18批 频率限制：呼叫后 60s 冷却禁点（客户端兜底）；服务端超限抛 CALL_TOO_FREQUENT → 专门提示
  function onCallWaiter() {
    startTransition(async () => {
      try {
        await callWaiter({
          slug,
          tableNo: orderType === 'dine_in' ? tableNo : undefined,
          phone,
        })
        setCallSent(true)
        setCallCooldown(true)
        setTimeout(() => setCallSent(false), 3000)
        setTimeout(() => setCallCooldown(false), 60000)
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg === 'CALL_TOO_FREQUENT') {
          setCallTooFrequent(true)
          setTimeout(() => setCallTooFrequent(false), 3000)
        } else {
          setError(t('error'))
        }
      }
    })
  }

  // 下单成功：成功卡 + 实时查单 / 复制订单号 + 推荐菜单
  if (done) {
    return (
      <main className={`mx-auto flex w-full max-w-md flex-col items-center gap-4 px-3 py-6 text-center text-fg theme-${theme}`}>
        {/* 成功卡：对勾 + 订单号 + 提示 */}
        <div className="w-full rounded-[var(--theme-radius-card)] border border-line bg-surface p-5 shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-fg">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </div>
          <h1 className="mt-3 text-xl font-semibold">
            {continueOrderNo ? t('addedToOrder') : t('orderSuccess')}
          </h1>
          <p className="mt-1 text-sm font-medium text-sub">{t('orderNo')} {done.displayNo}</p>
          <p className="mt-1 text-sm leading-relaxed text-sub">
            {continueOrderNo
              ? t('addSuccessHint', { orderNo: done.displayNo })
              : phone.trim()
                ? t('trackHint', { orderNo: done.displayNo, phone: phone.trim() })
                : t('trackHintNoPhone', { orderNo: done.displayNo })}
          </p>
        </div>

        {/* 实时查单（主操作）：有手机号时带预填，无手机号直接进查单 */}
        <div className="flex w-full flex-col gap-2.5">
          <Link
            href={`/s/${slug}/track?orderNo=${done.displayNo}${phone.trim() ? `&phone=${encodeURIComponent(phone.trim())}` : ''}`}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--theme-radius-btn)] bg-gradient-to-r from-primary to-primary-hover px-4 py-3 text-lg font-semibold text-primary-fg shadow-md shadow-primary/25 transition-transform hover:brightness-105 active:scale-[0.98]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18M9 3v2M15 3v2M3 5l2 14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2l2-14"/><path d="M9 12a3 3 0 0 1 6 0"/></svg>
            {continueOrderNo ? t('viewOrder') : t('trackNow')}
          </Link>
        </div>

        {/* 可能你还想吃（下单成功页推荐）：点击「+」跳查单页加菜（复用查单页自助加菜区） */}
        {recommended.length > 0 && (
          <div className="mt-6 w-full text-left">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-base font-bold">{t('youMayAlsoLike')}</h2>
              <span className="text-sm text-sub">{t('addMoreHint')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {recommended.slice(0, 4).map((p) => (
                <Link
                  key={p.id}
                  href={`/s/${slug}/track?orderNo=${done.displayNo}${phone.trim() ? `&phone=${encodeURIComponent(phone.trim())}` : ''}`}
                  className="relative flex flex-col overflow-hidden rounded-[var(--theme-radius-card)] border border-line bg-surface text-left shadow-sm transition-transform active:scale-[0.98]"
                >
                  {p.image ? (
                    <img src={p.image} alt={p.name} className="h-20 w-full object-cover" />
                  ) : (
                    <span className="flex h-20 w-full items-center justify-center bg-tile text-3xl">
                      {p.emoji}
                    </span>
                  )}
                  <div className="flex flex-1 flex-col p-2.5">
                    <span className="line-clamp-2 text-sm font-medium leading-snug">{p.name}</span>
                    <span className="mt-auto pt-1 text-sm font-semibold text-primary">
                      {formatPrice(Number(p.price), currency)}
                    </span>
                  </div>
                  <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-fg">
                    +
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    )
  }

  // 欢迎页：先选用餐方式（堂食/外带/外送）+ 店面介绍，选完进入菜单
  if (!selected) {
    return (
      <main className={`relative flex h-[100dvh] w-full max-w-md flex-col justify-center overflow-hidden px-4 py-6 text-fg theme-${theme}`}>
        {/* 开屏 hero 图整页背景 + 暗化（MiniMax 生成，越南河粉店风格）；h-[100dvh] 铺满视口，无上下滚动余地 */}
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero/hero.jpg"
            alt=""
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/35 to-black/65" />
        </div>

        {/* 毛玻璃内容卡：店名+语言切换一行 + 欢迎语 + 三选用餐方式浮于图上 */}
        <div className="relative z-10 flex flex-col gap-3 rounded-2xl bg-surface/75 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
          {activeBanner}
          {/* 店名 + 语言切换同一行（2026-08-29 用户需求） */}
          <div className="flex items-center justify-between gap-3">
            <h1 className="min-w-0 flex-1 truncate text-2xl font-bold">{shopName}</h1>
            {blocked ? (
              <span className="shrink-0 text-sm text-red-600 dark:text-red-400">{t(blocked)}</span>
            ) : null}
            <LocaleSwitcher />
          </div>

          <h2 className="text-center text-2xl font-bold">{t('welcome')}</h2>
          {shopDesc && (
            <p className="text-sm leading-relaxed text-sub">
              {shopDesc}
            </p>
          )}

          <p className="text-center text-base font-medium text-sub">
            {t('chooseType')}
          </p>
          <div className="flex flex-col gap-3">
            {(
              [
                ['dine_in', 'dineIn', '/hero/dine-in.jpg'],
                ['takeaway', 'takeaway', '/hero/takeaway.jpg'],
                ['delivery', 'delivery', '/hero/delivery.jpg'],
              ] as const
            ).map(([value, key, img]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setOrderType(value)
                  // Issue10 门控：切到外带/外送时清空桌号（切回堂食不恢复）
                  if (value !== 'dine_in') setTableNo('')
                  // 2026-08-29 用户需求：堂食强制先选桌号（非扫码进入时弹抽屉），选完才进菜单，
                  // 不再进入后补选；外带/外送或已有桌号直接进菜单
                  if (value === 'dine_in' && !tableNo.trim()) {
                    setTablePickerOpen(true)
                  } else {
                    setSelected(true)
                  }
                }}
                className="flex items-center gap-3 rounded-[var(--theme-radius-card)] border border-line bg-surface/90 px-4 py-3 text-left shadow-sm backdrop-blur transition-transform active:scale-[0.99]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-lg object-cover"
                />
                <span className="flex-1 text-base font-medium">{t(key)}</span>
                <span className="text-sub">›</span>
              </button>
            ))}
          </div>
        </div>

        {/* 桌号选择抽屉（欢迎页强制流程：选完桌号才进菜单，与菜单页共用组件） */}
        <TablePicker
          open={tablePickerOpen}
          value={tableNo}
          onChange={setTableNo}
          onConfirm={() => {
            setTablePickerOpen(false)
            setSelected(true)
          }}
          onDismiss={() => setTablePickerOpen(false)}
        />
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
    return <p className="px-6 py-16 text-center text-sub">{t('empty')}</p>
  }

  return (
    <div className={`mx-auto flex min-h-screen w-full max-w-md flex-col bg-app-bg px-3 pb-28 text-fg theme-${theme}`}>
      {/* 店头 + 语言切换（自动切换由 middleware 处理，这里供手动切换） */}
      <div className="flex items-center justify-between py-3">
        <h1 className="text-xl font-semibold">{shopName}</h1>
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          {blocked && (
            <span className="text-sm text-red-600 dark:text-red-400">{t(blocked)}</span>
          )}
        </div>
      </div>

      {activeBanner}

      {/* 用餐方式返回 + 呼叫服务员：一行 2 列加间隙，避免上下挤占误触（2026-08-29 用户需求） */}
      <div className={`grid gap-2 ${canOrder ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button
          type="button"
          onClick={() => setSelected(false)}
          className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-[var(--theme-radius-btn)] border border-line bg-surface px-3 text-lg font-medium text-fg shadow-sm transition-colors hover:bg-tile"
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
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {t(orderType === 'dine_in' ? 'dineIn' : orderType === 'takeaway' ? 'takeaway' : 'delivery')}
          <span className="text-xs text-sub">‹ {t('backToHome')}</span>
        </button>
        {canOrder && (
          <button
            type="button"
            onClick={onCallWaiter}
            disabled={pending || callCooldown}
            className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-[var(--theme-radius-btn)] border border-primary/40 px-3 text-lg text-primary-hover transition-colors hover:bg-primary/5 disabled:opacity-60"
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
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {t('callWaiter')}
          </button>
        )}
      </div>
      {(callSent || callTooFrequent) && (
        <p
          className={`text-center text-sm ${
            callSent
              ? 'text-green-600 dark:text-green-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {callSent ? t('callWaiterSent') : t('callTooFrequent')}
        </p>
      )}

      {/* 吸顶分类栏（2026-08-29 用户需求）：仅滚动停止后淡入，点击标签平滑跳转到对应分类；滚动中隐藏不挡菜 */}
      <nav
        aria-label={t('categoryNavLabel')}
        className={`sticky top-0 z-20 -mx-3 mb-1 flex flex-wrap justify-center gap-1.5 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur transition-opacity duration-200 ${
          catNavVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {groups.map((g, i) => (
          <button
            key={g.name ?? '__others'}
            type="button"
            onClick={() => scrollToCategory(i)}
            className="rounded-full border border-line px-3 py-1 text-lg text-sub transition-colors hover:bg-tile hover:text-fg"
          >
            {g.name ?? t('othersCategory')}
          </button>
        ))}
      </nav>

      {/* 商品列表（按分类分组）；分类标题加装饰分割线（2026-08-29 用户需求：上下有分割，不突兀） */}
      {groups.map((g, i) => (
        <div key={g.name ?? '__others'} id={`cat-${i}`} className="mt-5 scroll-mt-12">
          <div className="mb-2 flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <h2 className="text-center text-lg font-semibold text-sub">
              {g.name ?? t('othersCategory')}
            </h2>
            <div className="h-px flex-1 bg-line" />
          </div>
          <ul className="grid grid-cols-2 gap-2.5">
            {g.items.map((p) => {
              const n = qty[p.id] ?? 0
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setActiveProduct(p)}
                    className="relative flex w-full flex-col overflow-hidden rounded-[var(--theme-radius-card)] border border-line bg-surface text-left shadow-sm transition-transform active:scale-[0.98]"
                  >
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image}
                        alt={p.name}
                        className="h-24 w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-24 w-full items-center justify-center bg-tile text-4xl">
                        {p.emoji}
                      </span>
                    )}
                    {n > 0 && (
                      <span className="absolute right-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-fg">
                        {n}
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
            className="mx-auto flex w-full max-w-md items-center justify-between rounded-[var(--theme-radius-btn)] bg-gradient-to-r from-primary to-primary-hover px-5 py-3 text-primary-fg shadow-lg shadow-primary/30 active:scale-[0.99]"
          >
            <span className="text-lg font-semibold">
              {t('cart')} · {cartCount}
            </span>
            <span className="flex items-center gap-2">
              {orderType === 'delivery' && minOrderAmount > 0 && subtotal < minOrderAmount ? (
                <span className="text-xs opacity-80">
                  {t('minOrderHint', {
                    amount: formatPrice(minOrderAmount - subtotal, currency),
                  })}
                </span>
              ) : null}
              <span className="text-lg font-bold">{formatPrice(total, currency)}</span>
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
            className="flex max-h-[85vh] w-full max-w-md animate-slide-up flex-col rounded-t-[var(--theme-radius-card)] bg-surface text-fg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 抽屉头 */}
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h3 className="text-lg font-semibold">
                {t('cart')} ({cartCount})
              </h3>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="text-xl leading-none text-sub"
                aria-label="close"
              >
                ×
              </button>
            </div>

            {/* 明细列表 */}
            <div className="flex-1 overflow-y-auto px-5">
              {cartItems.length === 0 ? (
                <p className="py-10 text-center text-lg text-sub">{t('cartEmpty')}</p>
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
                      className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
                    >
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image}
                          alt={p.name}
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-tile text-2xl">
                          {p.emoji}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-lg font-medium">{p.name}</div>
                        {chosenOpts.length > 0 && (
                          <div className="truncate text-sm text-sub">
                            {chosenOpts.join(', ')}
                          </div>
                        )}
                        {exNames.length > 0 && (
                          <div className="truncate text-sm text-sub">
                            {exNames.map((nm) => `+${nm}`).join(' ')}
                          </div>
                        )}
                        {p.combo.length > 0 && (
                          <div className="truncate text-sm text-sub">
                            {p.combo
                              .map((c) => (c.qty > 1 ? `${c.name}×${c.qty}` : c.name))
                              .join(', ')}
                          </div>
                        )}
                        <div className="mt-0.5 text-lg font-semibold">
                          {formatPrice(lineTotal, currency)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setQ(p.id, n - 1)}
                          className="h-11 w-11 rounded-full border border-line text-lg"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-lg tabular-nums">{n}</span>
                        <button
                          type="button"
                          onClick={() => setQ(p.id, n + 1)}
                          className="h-11 w-11 rounded-full border border-line text-lg"
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
              className="flex flex-col gap-3 border-t border-line px-5 py-4"
            >
              {orderType === 'dine_in' && (
                <>
                  <label className="flex flex-col gap-1 text-lg">
                    <span className="text-sub">{t('tableNo')}</span>
                    <input
                      type="text"
                      value={tableNo}
                      onChange={(e) => setTableNo(e.target.value)}
                      placeholder="Bàn 5"
                      className="rounded-md border border-line px-3 py-2 text-lg"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-lg">
                    <input
                      type="checkbox"
                      checked={packing}
                      onChange={(e) => setPacking(e.target.checked)}
                    />
                    <span className="text-sub">
                      {t('packing')}
                      {packingFee > 0 ? ` (+${formatPrice(packingFee, currency)})` : ''}
                    </span>
                  </label>
                </>
              )}
              {orderType === 'delivery' && (
                <>
                  {deliveryArea && (
                    <p className="text-sm text-sub">
                      {t('deliveryArea')}: {deliveryArea}
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-lg">
                    <input
                      type="checkbox"
                      checked={pickup}
                      onChange={(e) => setPickup(e.target.checked)}
                    />
                    <span className="text-sub">
                      {t('pickup')} ({t('noDeliveryFee')})
                    </span>
                  </label>
                  {!pickup && (
                    <label className="flex flex-col gap-1 text-lg">
                      <span className="text-sub">{t('address')}</span>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="12 Nguyễn Huệ, P.5"
                        className="rounded-md border border-line px-3 py-2 text-lg"
                      />
                    </label>
                  )}
                </>
              )}

              <label className="flex flex-col gap-1 text-lg">
                <span className="text-sub">
                  {t('phone')}
                  {orderType === 'delivery' && !pickup ? (
                    <span className="text-red-500"> *</span>
                  ) : (
                    <span className="text-sub"> ({t('optional')})</span>
                  )}
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('phonePlaceholder')}
                  required={orderType === 'delivery' && !pickup}
                  className="rounded-md border border-line px-3 py-2 text-lg"
                />
              </label>

              <label className="flex flex-col gap-1 text-lg">
                <span className="text-sub">{t('note')}</span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('notePlaceholder')}
                  className="rounded-md border border-line px-3 py-2 text-lg"
                />
              </label>

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex items-center justify-between">
                <span className="text-lg text-sub">
                  {t('total')}: {formatPrice(total, currency)}
                  {deliveryCharge > 0 && (
                    <span className="text-sub dark:text-sub">
                      {' '}({t('deliveryFee')} {formatPrice(deliveryCharge, currency)})
                    </span>
                  )}
                  {packingCharge > 0 && (
                    <span className="text-sub dark:text-sub">
                      {' '}({t('packingFee')} {formatPrice(packingCharge, currency)})
                    </span>
                  )}
                  {orderType === 'delivery' && !pickup && minOrderAmount > 0 && subtotal < minOrderAmount
                    ? ` · ${t('minOrderHint', {
                        amount: formatPrice(minOrderAmount - subtotal, currency),
                      })}`
                    : ''}
                </span>
                <button
                  type="submit"
                  disabled={
                    !canOrder ||
                    pending ||
                    subtotal === 0 ||
                    (orderType === 'delivery' && !pickup && minOrderAmount > 0 && subtotal < minOrderAmount)
                  }
                  className="rounded-[var(--theme-radius-btn)] bg-gradient-to-r from-primary to-primary-hover px-5 py-2 text-lg font-semibold text-primary-fg shadow-md shadow-primary/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
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
        currency={currency}
        onClose={() => setActiveProduct(null)}
        onAdd={addFromSheet}
      />

      {/* 一键返回顶部：滚动停止且滚得较深时出现，点按平滑回顶（2026-08-29 需求5） */}
      {backTopVisible && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label={t('backToTop')}
          className="fixed bottom-20 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-fg shadow-lg transition-opacity duration-200 hover:bg-tile"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  )
}

// 加购抽屉（问题 1）：点商品弹出，选规格组（单选）/加料（多选）/数量 → 加入购物车
// 导出供查单页加菜区（AddMoreMenu）复用：点「+」→ 选规格/加料 → 暂存待确认
export function AddToCartSheet({
  product,
  currency,
  onClose,
  onAdd,
}: {
  product: MenuProduct | null
  currency: string
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
        className="flex max-h-[90vh] w-full max-w-lg animate-slide-up flex-col overflow-y-auto rounded-t-[var(--theme-radius-card)] bg-surface p-5 pb-8 text-fg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image}
            alt={product.name}
            className="h-72 w-full rounded-[var(--theme-radius-card)] object-cover"
          />
        ) : (
          <span className="flex h-24 w-24 items-center justify-center rounded-[var(--theme-radius-card)] bg-tile text-5xl">
            {product.emoji}
          </span>
        )}
        <h3 className="mt-3 text-lg font-semibold">{product.name}</h3>
        {product.desc && (
          <p className="mt-1 text-sm leading-relaxed text-sub">{product.desc}</p>
        )}

        {/* 套餐组成（combo）：展示套餐包含的商品 */}
        {product.combo.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold text-sub">{t('combo')}</div>
            <ul className="space-y-1 text-sm text-sub">
              {product.combo.map((c, i) => (
                <li key={i} className="flex justify-between">
                  <span>{c.name}</span>
                  <span className="text-sub">×{c.qty}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 规格组（单选） */}
        {product.optionGroups.map((g) => (
          <div key={g.name} className="mt-4">
            <div className="mb-2 text-sm font-semibold text-sub">
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
                        ? 'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-primary bg-soft px-4 text-sm font-semibold text-fg'
                        : 'inline-flex min-h-[44px] items-center rounded-full border border-line px-4 text-sm text-fg'
                    }
                  >
                    {o.name}
                    {Number(o.price) > 0
                      ? ` +${formatPrice(Number(o.price), currency)}`
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
            <div className="mb-2 text-sm font-semibold text-sub">
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
                        ? 'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-primary bg-soft px-4 text-sm font-semibold text-fg'
                        : 'inline-flex min-h-[44px] items-center rounded-full border border-line px-4 text-sm text-fg'
                    }
                  >
                    {ex.name} +{formatPrice(Number(ex.price), currency)}
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
              className="h-11 w-11 rounded-full border border-line text-lg"
            >
              −
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => q + 1)}
              className="h-11 w-11 rounded-full border border-line text-lg"
            >
              +
            </button>
          </div>
          <div className="text-lg font-bold">{formatPrice(lineTotal, currency)}</div>
        </div>

        <button
          type="button"
          onClick={() => onAdd(product.id, qty, selExtras, selOptions)}
          className="mt-4 w-full rounded-[var(--theme-radius-btn)] bg-gradient-to-r from-primary to-primary-hover py-3 text-lg font-semibold text-primary-fg shadow-md shadow-primary/25 transition-transform hover:brightness-105 active:scale-[0.99]"
        >
          {t('addToCart')} · {formatPrice(lineTotal, currency)}
        </button>
      </div>
    </div>
  )
}

// 桌号选择抽屉（2026-08-29 用户需求）：欢迎页堂食强制先选桌号（选完 onConfirm 才进菜单）；
// 点背景 onDismiss 留在当前页（欢迎页则不进菜单）。仅欢迎页渲染此弹层。
function TablePicker({
  open,
  value,
  onChange,
  onConfirm,
  onDismiss,
}: {
  open: boolean
  value: string
  onChange: (v: string) => void
  onConfirm: () => void
  onDismiss: () => void
}) {
  const t = useTranslations('menu')
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in"
      onClick={onDismiss}
    >
      <div
        className="flex w-full max-w-md animate-slide-up flex-col rounded-t-[var(--theme-radius-card)] bg-surface p-5 pb-8 text-fg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <h3 className="text-center font-semibold">{t('chooseTable')}</h3>

        {/* 常用桌号 1-12：点选即回填关闭 */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                onChange(String(n))
                onConfirm()
              }}
              className="rounded-lg border border-line bg-tile py-2.5 text-sm font-medium transition-colors hover:bg-primary/10"
            >
              {n}
            </button>
          ))}
        </div>

        {/* 自定义桌号：手动输入，确认后回填关闭 */}
        <div className="mt-4 flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('tableCustom')}
            className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-lg"
          />
          <button
            type="button"
            onClick={() => {
              if (value.trim()) onConfirm()
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg"
          >
            {t('submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
