import { getTranslations, getLocale } from 'next-intl/server'
import { requireUser } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { signOut } from '@/auth'
import { formatPrice } from '@/lib/format'
import { isShopExpired } from '@/lib/billing'
import { getShopBySlug } from '@/lib/tenant'
import { redirect, Link } from '@/i18n/navigation'
import { OrderList } from '@/components/dashboard/order-list'
import type { OrderPlain, ShopPlain } from '@/components/dashboard/order-list'
import { SettingsPanel } from '@/components/dashboard/settings-panel'
import type { ProductPlain } from '@/components/dashboard/settings-panel'
import { RevenueCard } from '@/components/dashboard/revenue-card'
import { ReminderList } from '@/components/dashboard/reminder-list'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { SideDrawer } from '@/components/dashboard/side-drawer'
import { BackToTop } from '@/components/dashboard/back-to-top'
import type { ReminderPlain } from '@/components/dashboard/reminder-list'

// 订单状态 → 本地化 key（dashboard 段）
const STATUS_KEY: Record<string, string> = {
  PENDING: 'statusPending',
  IN_PROGRESS: 'statusInProgress',
  READY: 'statusReady',
  COMPLETED: 'statusCompleted',
  CANCELLED: 'statusCancelled',
}

// 老板侧一页后台：今日概览 + 桌台简表 + 待办提醒 + 订单列表 + 设置
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string }>
}) {
  const user = await requireUser()
  const t = await getTranslations('dashboard')

  // 授权分支：OWNER 用自身 shopId（忽略 ?shop=）；ADMIN 带 ?shop=slug 进店视角，无参数回中台
  let shopId: string
  let isAdminView = false
  if (user.role === 'OWNER') {
    if (!user.shopId) {
      // OWNER 无店属数据异常，踢回登录（原 requireOwner 语义）
      const locale = await getLocale()
      redirect({ href: '/login', locale })
      throw new Error('unreachable: redirect did not throw')
    }
    shopId = user.shopId
  } else {
    // ADMIN：?shop=slug 指定目标店，否则回中台
    const sp = await searchParams
    if (!sp.shop) {
      const locale = await getLocale()
      redirect({ href: '/admin', locale })
      throw new Error('unreachable: redirect did not throw')
    }
    shopId = (await getShopBySlug(sp.shop)).id
    isAdminView = true
  }

  const [shop, orders, products, reminders] = await Promise.all([
    prisma.shop.findUnique({ where: { id: shopId } }),
    prisma.order.findMany({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.findMany({
      where: { shopId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.reminder.findMany({
      where: { shopId, status: 'PENDING', dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
    }),
  ])

  if (!shop) return null

  // 订阅到期判断：老板后台顶部横幅提示（客户侧已同步拦截下单）
  const subscriptionExpired = isShopExpired(shop)

  const shopPlain: ShopPlain = {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    phone: shop.phone,
    open: shop.open,
    currency: shop.currency,
    config: shop.config as ShopPlain['config'],
  }

  const ordersPlain: OrderPlain[] = orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    displayNo: o.displayNo,
    total: o.total.toString(),
    paidAmount: o.paidAmount.toString(),
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    status: o.status,
    note: o.note,
    orderType: (o.config as { orderType?: string } | null)?.orderType ?? null,
    tableNo: (o.config as { tableNo?: string } | null)?.tableNo ?? null,
    address: (o.config as { address?: string } | null)?.address ?? null,
    createdAt: o.createdAt.toISOString(),
    items: o.items as unknown as OrderPlain['items'],
  }))

  const productsPlain: ProductPlain[] = products.map((p) => {
    const cfg = p.config as {
      image?: string
      emoji?: string
      nameI18n?: Record<string, string>
      descI18n?: Record<string, string>
      extras?: { name: string; price: number }[]
      optionGroups?: {
        name: string
        required?: boolean
        options: { name: string; price?: number }[]
      }[]
      combo?: { name: string; qty: number }[]
      bestseller?: boolean
    } | null
    return {
      id: p.id,
      name: p.name,
      price: p.price.toString(),
      active: p.active,
      emoji: cfg?.emoji ?? '🍽️',
      unit: p.unit,
      category: p.category,
      image: cfg?.image ?? '',
      nameZh: cfg?.nameI18n?.zh ?? '',
      nameEn: cfg?.nameI18n?.en ?? '',
      descVi: cfg?.descI18n?.vi ?? '',
      descZh: cfg?.descI18n?.zh ?? '',
      descEn: cfg?.descI18n?.en ?? '',
      extras: (cfg?.extras ?? []).map((ex) => ({
        name: ex.name,
        price: ex.price.toString(),
      })),
      optionGroups: (cfg?.optionGroups ?? []).map((g) => ({
        name: g.name,
        required: g.required ?? false,
        options: g.options.map((o) => ({
          name: o.name,
          price: (o.price ?? 0).toString(),
        })),
      })),
      combo: (cfg?.combo ?? []).map((c) => ({ name: c.name, qty: c.qty })),
      bestseller: cfg?.bestseller ?? false,
    }
  })

  // C1 今日概览统计
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const todayOrders = orders.filter((o) => o.createdAt >= startOfDay)
  const todayCount = todayOrders.length
  const todayRevenue = todayOrders.reduce((s, o) => s + Number(o.total), 0)
  // 营业额多档统计（1 天 = 今日，3/7/30 天 = 滚动窗口，供 RevenueCard 二级明细）
  const dayMs = 24 * 60 * 60 * 1000
  const inRange = (days: number) =>
    orders.filter((o) => o.createdAt >= new Date(Date.now() - days * dayMs))
  const revenueRange = (days: number) =>
    inRange(days).reduce((s, o) => s + Number(o.total), 0)
  const revenue3d = revenueRange(3)
  const revenue7d = revenueRange(7)
  const revenue30d = revenueRange(30)
  const count1 = todayCount
  const count3 = inRange(3).length
  const count7 = inRange(7).length
  const count30 = inRange(30).length
  const openCount = orders.filter(
    (o) => !['COMPLETED', 'CANCELLED'].includes(o.status),
  ).length

  // C3 桌台简表：今日堂食订单按桌号
  const tables = todayOrders
    .map((o) => {
      const cfg = o.config as { orderType?: string; tableNo?: string } | null
      return cfg?.orderType === 'dine_in' && cfg?.tableNo
        ? { tableNo: cfg.tableNo, status: String(o.status) }
        : null
    })
    .filter((x): x is { tableNo: string; status: string } => x !== null)

  // D 待办提醒序列化
  const remindersPlain: ReminderPlain[] = reminders.map((r) => {
    const p = r.payload as {
      displayNo?: string
      customerName?: string | null
      customerPhone?: string | null
      tableNo?: string | null
      total?: number
      orderType?: string | null
      items?: { name: string; qty: number }[]
    } | null
    return {
      id: r.id,
      orderId: r.orderId,
      templateKey: r.templateKey,
      displayNo: p?.displayNo ?? '',
      customerPhone: p?.customerPhone ?? null,
      customerName: p?.customerName ?? null,
      tableNo: p?.tableNo ?? null,
      total: p?.total != null ? p.total.toString() : '',
      orderType: p?.orderType ?? null,
      items: p?.items ?? [],
    }
  })

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-4">
      {isAdminView && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-sm dark:border-blue-700 dark:bg-blue-950/40">
          <span className="font-medium text-blue-800 dark:text-blue-300">
            {t('adminView', { name: shop.name })}
          </span>
          <Link
            href="/admin"
            className="shrink-0 rounded-md border border-blue-300 px-2 py-1 text-xs text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/40"
          >
            {t('backToAdmin')}
          </Link>
        </div>
      )}
      {subscriptionExpired && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {t('subscriptionExpired')}
        </div>
      )}
      {/* 顶栏：店名（点开抽屉）+ 语言切换 */}
      <header className="sticky top-0 z-30 -mx-6 mb-2 flex items-center justify-between border-b border-zinc-100 bg-orange-50/90 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <SideDrawer
          trigger={
            <span className="flex items-center gap-2">
              <span className="text-lg leading-none text-zinc-400">☰</span>
              <span className="text-lg font-semibold">{shop.name}</span>
            </span>
          }
          title={<span>{shop.name}</span>}
        >
          {/* 抽屉内容：概览 + 桌台 + 设置 + 退出登录 */}
          <div className="flex flex-col gap-6">
            {/* C1 今日概览 */}
            <section className="grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white p-3 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <svg
                  className="h-5 w-5 text-amber-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M8 13h8M8 17h6" />
                </svg>
                <p className="mt-1 text-2xl font-semibold text-amber-600 dark:text-amber-500">{todayCount}</p>
                <p className="text-xs text-zinc-500">{t('todayOrders')}</p>
              </div>
              <RevenueCard
                day1={todayRevenue}
                day3={revenue3d}
                day7={revenue7d}
                day30={revenue30d}
                count1={count1}
                count3={count3}
                count7={count7}
                count30={count30}
                currency={shop.currency}
              />
              <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white p-3 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <svg
                  className="h-5 w-5 text-amber-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <path d="M21 3v6h-6" />
                </svg>
                <p className="mt-1 text-2xl font-semibold text-amber-600 dark:text-amber-500">{openCount}</p>
                <p className="text-xs text-zinc-500">{t('openOrders')}</p>
              </div>
            </section>

            {/* C3 桌台简表 */}
            {tables.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-lg font-medium">{t('tables')}</h2>
                <div className="flex flex-wrap gap-2">
                  {tables.map((tb, idx) => (
                    <span
                      key={idx}
                      className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700"
                    >
                      {tb.tableNo} · {t(STATUS_KEY[tb.status] ?? 'statusPending')}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* 设置 + 商品管理 */}
            <SettingsPanel products={productsPlain} shop={shopPlain} />

            {/* 退出登录（抽屉底部，防误碰） */}
            <form
              action={async () => {
                'use server'
                await signOut({ redirectTo: '/login' })
              }}
              className="flex justify-center pt-2"
            >
              <button className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                {t('logout')}
              </button>
            </form>
          </div>
        </SideDrawer>

        <LocaleSwitcher />
      </header>

      {/* 主页：待办提醒 + 订单列表（核心） */}
      <ReminderList reminders={remindersPlain} shopName={shop.name} currency={shop.currency} />
      <OrderList orders={ordersPlain} shop={shopPlain} products={productsPlain} />

      {/* 回到顶部浮动按钮 */}
      <BackToTop />
    </main>
  )
}
