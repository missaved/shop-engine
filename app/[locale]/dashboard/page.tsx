import { getTranslations } from 'next-intl/server'
import { requireUser } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { signOut } from '@/auth'
import { formatPrice } from '@/lib/format'
import { OrderList } from '@/components/dashboard/order-list'
import type { OrderPlain, ShopPlain } from '@/components/dashboard/order-list'
import { SettingsPanel } from '@/components/dashboard/settings-panel'
import type { ProductPlain } from '@/components/dashboard/settings-panel'
import { RevenueCard } from '@/components/dashboard/revenue-card'
import { ReminderList } from '@/components/dashboard/reminder-list'
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
export default async function DashboardPage() {
  const user = await requireUser()
  const t = await getTranslations('dashboard')

  const [shop, orders, products, reminders] = await Promise.all([
    prisma.shop.findUnique({ where: { id: user.shopId } }),
    prisma.order.findMany({
      where: { shopId: user.shopId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.findMany({
      where: { shopId: user.shopId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.reminder.findMany({
      where: { shopId: user.shopId, status: 'PENDING', dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
    }),
  ])

  if (!shop) return null

  const shopPlain: ShopPlain = {
    id: shop.id,
    name: shop.name,
    phone: shop.phone,
    open: shop.open,
    config: shop.config as { openHours?: string; minOrderAmount?: number } | null,
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
  // 营业额多档统计（1 天 = 今日，3/7/30 天 = 滚动窗口，供 RevenueCard 切换）
  const dayMs = 24 * 60 * 60 * 1000
  const revenueRange = (days: number) =>
    orders
      .filter((o) => o.createdAt >= new Date(Date.now() - days * dayMs))
      .reduce((s, o) => s + Number(o.total), 0)
  const revenue3d = revenueRange(3)
  const revenue7d = revenueRange(7)
  const revenue30d = revenueRange(30)
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
    } | null
    return {
      id: r.id,
      templateKey: r.templateKey,
      displayNo: p?.displayNo ?? '',
      customerPhone: p?.customerPhone ?? null,
      customerName: p?.customerName ?? null,
      tableNo: p?.tableNo ?? null,
      total: p?.total != null ? p.total.toString() : '',
    }
  })

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{shop.name}</h1>
          <p className="text-sm text-zinc-500">{t('title')}</p>
        </div>
      </div>

      {/* P0-6 锚点导航：订单 / 设置（提升设置区可发现性） */}
      <nav className="flex gap-2">
        <a
          href="#orders"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {t('navOrders')}
        </a>
        <a
          href="#settings"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {t('navSettings')}
        </a>
      </nav>

      {/* C1 今日概览 */}
      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-2xl font-semibold text-amber-600 dark:text-amber-500">{todayCount}</p>
          <p className="text-xs text-zinc-500">{t('todayOrders')}</p>
        </div>
        <RevenueCard day1={todayRevenue} day3={revenue3d} day7={revenue7d} day30={revenue30d} />
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-2xl font-semibold text-amber-600 dark:text-amber-500">{openCount}</p>
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

      <ReminderList reminders={remindersPlain} shopName={shop.name} />
      <div id="orders" className="scroll-mt-4">
        <OrderList orders={ordersPlain} shop={shopPlain} products={productsPlain} />
      </div>
      <div id="settings" className="scroll-mt-4">
        <SettingsPanel products={productsPlain} shop={shopPlain} />
      </div>

      {/* 退出登录移到底部（防误碰），弱化样式 */}
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
    </main>
  )
}
