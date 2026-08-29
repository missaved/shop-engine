import { getTranslations } from 'next-intl/server'
import { requireOwner } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { signOut } from '@/auth'
import { formatPrice } from '@/lib/format'
import { isShopExpired } from '@/lib/billing'
import { OrderList } from '@/components/dashboard/order-list'
import type { OrderPlain, ShopPlain } from '@/components/dashboard/order-list'
import { SettingsPanel } from '@/components/dashboard/settings-panel'
import type { ProductPlain } from '@/components/dashboard/settings-panel'
import { ReminderList } from '@/components/dashboard/reminder-list'
import { SideDrawer } from '@/components/dashboard/side-drawer'
import { BackToTop } from '@/components/dashboard/back-to-top'
import type { ReminderPlain } from '@/components/dashboard/reminder-list'
import { FOOD_SUBCATEGORIES } from '@/lib/llm/prompts'
import type { PresetOption } from '@/components/dashboard/preset-onboarding'
import type { DraftItem } from '@/lib/preset-actions'

// FoodPreset.items 单道菜（生成结构；第 20 批含酒水规格 optionGroups；多语言整改加三语字段）
type PresetDishItem = {
  nativeName: string
  name_zh?: string
  name_en?: string
  description_local?: string
  description_zh?: string
  description_en?: string
  defaultPrice: number
  unit?: string
  unit_zh?: string
  extras?: string[]
  extras_zh?: string[]
  optionGroups?: { name: string; nameZh?: string; options: { name: string; nameZh?: string; price: number }[] }[]
  allergens?: string[]
  dietaryTags?: string[]
  imageUrl?: string
  categoryI18n?: { vi: string; zh: string; en: string }
}

// 订单状态 → 本地化 key（dashboard 段）
const STATUS_KEY: Record<string, string> = {
  PENDING: 'statusPending',
  IN_PROGRESS: 'statusInProgress',
  READY: 'statusReady',
  COMPLETED: 'statusCompleted',
  CANCELLED: 'statusCancelled',
}

// 订单查询排序：进行中（PENDING/IN_PROGRESS/READY）在前，终态（COMPLETED/CANCELLED）在后，组内 createdAt desc
// （Prisma 7 orderBy 仅支持标量 asc/desc，无法单条表达「终态后置」，故拆两次查询拼接）
async function findOrdersForDashboard(shopId: string) {
  const [active, terminal] = await Promise.all([
    prisma.order.findMany({
      where: { shopId, status: { in: ['PENDING', 'IN_PROGRESS', 'READY'] } },
      orderBy: [{ createdAt: 'desc' }],
    }),
    prisma.order.findMany({
      where: { shopId, status: { in: ['COMPLETED', 'CANCELLED'] } },
      orderBy: [{ createdAt: 'desc' }],
    }),
  ])
  return [...active, ...terminal]
}

// 老板侧一页后台：今日概览 + 桌台简表 + 待办提醒 + 订单列表 + 设置
export default async function DashboardPage() {
  // 第 20 批 A4（8.1 决策）：admin 不参与 boss 端、不能进店 → dashboard 只服务 OWNER
  const user = await requireOwner()
  const shopId = user.shopId
  const t = await getTranslations('dashboard')

  const [shop, orders, products, reminders, presets, categories, shopDraft] = await Promise.all([
    prisma.shop.findUnique({ where: { id: shopId } }),
    findOrdersForDashboard(shopId),
    prisma.product.findMany({
      where: { shopId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.reminder.findMany({
      where: { shopId, status: 'PENDING', dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
      // 带出关联订单状态 + 下单时间：过滤已取消单的待办（用户反馈）+ 实时显示「下单多久」（第16批）
      include: { order: { select: { status: true, createdAt: true } } },
    }),
    // AI 预设库（A6 开店引导）：全部 FOOD 子分类预设（仅 active 会在前端可选）
    prisma.foodPreset.findMany({ where: { country: 'VN' } }),
    // Admin「新增品类」（第 20 批）：自定义子分类 meta，供开店引导合并展示
    prisma.presetCategory.findMany({ where: { active: true } }),
    // 引导草稿（9.1 独立表；items=草稿菜品，snapshot=覆盖前快照）
    prisma.shopDraft.findUnique({ where: { shopId } }),
  ])

  if (!shop) return null

  // 订阅到期判断：老板后台顶部横幅提示（客户侧已同步拦截下单）
  const subscriptionExpired = await isShopExpired(shop)

  const shopPlain: ShopPlain = {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    phone: shop.phone,
    open: shop.open,
    currency: shop.currency,
    config: shop.config as ShopPlain['config'],
  }

  // 业务日边界：固定 UTC+7（越南运营时区），避免服务器 UTC 造成的「今日」偏移
  // （UTC 0 点 = 越南 07:00，若用服务器 UTC 会把越南今晨 0-7 点的订单误判为历史）
  const VIET_OFFSET = 7 * 60 * 60 * 1000
  const vietTodayStart = new Date(Date.now() + VIET_OFFSET)
  vietTodayStart.setHours(0, 0, 0, 0)
  const todayStartUtc = new Date(vietTodayStart.getTime() - VIET_OFFSET)

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
    today: o.createdAt >= todayStartUtc,
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
      canAddOn?: boolean
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
      // 出餐后可追加（默认 true，READY 阶段客户加菜仅限此商品）
      canAddOn: cfg?.canAddOn ?? true,
    }
  })

  // A6 开店引导数据：预设选项（静态 FOOD_SUBCATEGORIES + Admin「新增品类」PresetCategory，第 20 批带 cuisine 分组）+ 草稿 + 快照标记
  const presetsPlain: PresetOption[] = [
    ...Object.entries(FOOD_SUBCATEGORIES).map(([key, meta]) => {
      const p = presets.find((x) => x.subcategory === key)
      return {
        subcategory: key,
        name: `${meta.vi} · ${meta.zh}`,
        count: p ? (p.items as unknown[]).length : 0,
        active: p?.active ?? false,
        cuisine: meta.cuisine,
      }
    }),
    ...categories.map((c) => {
      const p = presets.find((x) => x.subcategory === c.key)
      return {
        subcategory: c.key,
        name: `${c.nameVi} · ${c.nameZh}`,
        count: p ? (p.items as unknown[]).length : 0,
        active: p?.active ?? false,
        cuisine: c.cuisine as PresetOption['cuisine'],
      }
    }),
  ]
  const draftItemsPlain: DraftItem[] = shopDraft
    ? ((shopDraft.items as PresetDishItem[]) ?? []).map((it) => ({
        nativeName: it.nativeName,
        nameZh: it.name_zh ?? '',
        nameEn: it.name_en ?? '',
        descVi: it.description_local ?? '',
        descZh: it.description_zh ?? it.description_local ?? '',
        descEn: it.description_en ?? '',
        price: Number(it.defaultPrice ?? 0),
        unit: it.unit ?? '',
        unitZh: it.unit_zh ?? '',
        extras: it.extras ?? [],
        extrasZh: it.extras_zh ?? [],
        optionGroups: it.optionGroups ?? [],
        allergens: it.allergens ?? [],
        dietaryTags: it.dietaryTags ?? [],
        imageUrl: it.imageUrl ?? '',
        categoryI18n: it.categoryI18n,
      }))
    : []
  const hasSnapshot = !!shopDraft?.snapshot && (shopDraft.snapshot as unknown[]).length > 0

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

  // D 待办提醒序列化（用户反馈：取消订单的待办无意义 → 查询端已过滤 + 此处兜底）
  const remindersPlain: ReminderPlain[] = reminders
    .filter((r) => r.order?.status !== 'CANCELLED')
    .map((r) => {
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
        orderStatus: r.order?.status ?? null,
        // 订单下单时间：待办实时显示「下单多久」（第16批，客户端每 30s tick 刷新）
        orderCreatedAt: r.order?.createdAt?.toISOString() ?? null,
        items: p?.items ?? [],
      }
    })

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-4">
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
          {/* 抽屉内容：桌台 + 设置 + 退出登录（营业概览已移主区，Issue9） */}
          <div className="flex flex-col gap-6">
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

            {/* 设置 + 商品管理（含 账户授权 + 退出登录，均随内容流；营业额/今日统计移入设置，用户反馈） */}
            <SettingsPanel
              products={productsPlain}
              shop={shopPlain}
              onLogout={async () => {
                'use server'
                await signOut({ redirectTo: '/login' })
              }}
              todayRevenue={todayRevenue}
              revenue3d={revenue3d}
              revenue7d={revenue7d}
              revenue30d={revenue30d}
              todayCount={todayCount}
              count3={count3}
              count7={count7}
              count30={count30}
              presets={presetsPlain}
              draftItems={draftItemsPlain}
              hasSnapshot={hasSnapshot}
            />
          </div>
        </SideDrawer>

        {/* 进行中订单数（用户反馈：放店名一排，不挤占主区） */}
        <span className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          {t('openOrders')} {openCount}
        </span>
      </header>

      {/* 主页：待办提醒 + 订单列表（核心；营业额/今日统计已移入设置面板，用户反馈不要挤占首页） */}
      <ReminderList reminders={remindersPlain} shopName={shop.name} currency={shop.currency} />
      <OrderList orders={ordersPlain} shop={shopPlain} products={productsPlain} />

      {/* 回到顶部浮动按钮 */}
      <BackToTop />
    </main>
  )
}
