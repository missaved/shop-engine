// 客户侧查单页：/{vertical}/{slug}/track?phone=..&orderNo=..（GET 表单，结果可刷新/分享）
// 注意：文件内已有本地布尔 `notFound`（查单失败态），故 next/navigation 的 404 函数需别名导入
import { notFound as notFoundPage } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getShopBySlug, ShopUnavailableError } from '@/lib/tenant'
import { ShopUnavailableView } from '@/components/shop/shop-unavailable'
import { isRateLimited, recordFailure } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/phone'
import { parseVerticalSlug } from '@/lib/vertical'
import { parseCitySlug } from '@/lib/city'
import { Link } from '@/i18n/navigation'
import { CallWaiterButton } from '@/components/shop/call-waiter-button'
import { DeleteMyData } from '@/components/shop/delete-my-data'
import { TrackStatus } from '@/components/shop/track-status'
import { AddMoreMenu } from '@/components/shop/add-more-menu'
import { getRecommendedProducts } from '@/lib/menu'
import { normalizeTheme } from '@/lib/theme'
import { formatPrice } from '@/lib/format'
import { shopSubUrl, shopUrl } from '@/lib/urls'
import { getCurrentUser } from '@/lib/dal'

export default async function TrackOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; city: string; vertical: string; slug: string }>
  searchParams: Promise<{ orderNo?: string; phone?: string }>
}) {
  const { slug, locale, city: cityParam, vertical: verticalParam } = await params
  const vertical = parseVerticalSlug(verticalParam)
  if (!vertical) notFoundPage()
  const city = parseCitySlug(cityParam)
  if (!city) notFoundPage()
  const { orderNo: orderNoStr, phone } = await searchParams
  const t = await getTranslations('track')

  // 维护模式全拦（含查单）/ 入驻审核未通过店：getShopBySlug 抛 ShopUnavailableError → 渲染提示页
  let shop: Awaited<ReturnType<typeof getShopBySlug>>
  try {
    shop = await getShopBySlug(slug, { expectVertical: vertical })
  } catch (e) {
    if (e instanceof ShopUnavailableError) {
      return (
        <ShopUnavailableView reason={e.reason} rejectReason={e.rejectReason} />
      )
    }
    throw e
  }

  let order: Awaited<ReturnType<typeof prisma.order.findFirst>> = null
  let notFound = false
  let notFoundNoPhone = false // 无手机号单查询失败（区别于带号单，分流文案）
  let rateLimited = false
  let ipMatched = false // Issue7：IP+30min 兜底命中（无号无 cookie 场景，返回直接显示）

  // 游客自动查单：读 cookie guest_key（下单时写入），免填订单号锁定本人订单
  const reqHeaders = await headers()
  const cookieStr = reqHeaders.get('cookie') ?? ''
  const guestKeyRaw = cookieStr.match(/(?:^|;\s*)guest_key=([^;]*)/)?.[1]?.trim() ?? ''
  const guestKey = guestKeyRaw ? decodeURIComponent(guestKeyRaw) : ''
  // 登录用户：按账号查自己订单（#3，2026-09-01）。读取 session customerId；无则不启用，游客照旧走 guestKey/表单
  const customerId = (await getCurrentUser())?.customerId ?? null

  // 查单：对外订单号 displayNo（CP-YYMMDD-NNN）+ 手机号（归一化后精确匹配）
  const no = orderNoStr?.trim()
  const normPhone = phone ? normalizePhone(phone) : ''
  if (no && normPhone) {
    // 带号单：displayNo + 归一化手机号，IP + 手机号双维度限流（防枚举）
    const fwd = reqHeaders.get('x-forwarded-for')
    const ip = (fwd ? fwd.split(',')[0].trim() : reqHeaders.get('x-real-ip')?.trim()) || 'unknown'
    const keyIp = `track:ip:${ip}`
    const keyPhone = `track:phone:${normPhone}`
    if (isRateLimited(keyIp) || isRateLimited(keyPhone)) {
      rateLimited = true
    } else {
      const found = await prisma.order.findFirst({
        where: { shopId: shop.id, displayNo: no, customerPhone: normPhone },
      })
      if (found) {
        order = found
      } else {
        notFound = true
        recordFailure(keyIp)
        recordFailure(keyPhone)
      }
    }
  } else if (no && guestKey) {
    // 同设备只填订单号（手机号留空）：按 displayNo+guestKey 精确匹配本人单，不取最新单
    order = await prisma.order.findFirst({
      where: { shopId: shop.id, displayNo: no, config: { path: ['guestKey'], equals: guestKey } },
    })
    if (!order) notFound = true
  } else if (no) {
    // 无手机号单：按 displayNo + customerPhone:null 查（外带/堂食未留号场景；仅静态查看，限流只按 IP）
    const fwd = reqHeaders.get('x-forwarded-for')
    const ip = (fwd ? fwd.split(',')[0].trim() : reqHeaders.get('x-real-ip')?.trim()) || 'unknown'
    const keyIp = `track:ip:${ip}`
    if (isRateLimited(keyIp)) {
      rateLimited = true
    } else {
      order = await prisma.order.findFirst({
        where: { shopId: shop.id, displayNo: no, customerPhone: null },
      })
      if (!order) {
        notFoundNoPhone = true
        recordFailure(keyIp)
      }
    }
  } else if (customerId) {
    // 登录用户免填：按 customerId 匹配本人最新一单（账号级，比游客 guestKey 设备级更精准）
    order = await prisma.order.findFirst({
      where: { shopId: shop.id, customerId },
      orderBy: { createdAt: 'desc' },
    })
  } else if (guestKey) {
    // 游客免填：按 guestKey 匹配最新一单（无 cookie 或换设备则回退手动表单）
    order = await prisma.order.findFirst({
      where: { shopId: shop.id, config: { path: ['guestKey'], equals: guestKey } },
      orderBy: { createdAt: 'desc' },
    })
  } else {
    // Issue7 匿名兜底：无号无 cookie（清 cookie/换设备场景）→ 按「请求 IP + 30 分钟内」匹配本店匿名单，
    // 命中直接显示（含实时进度），免输入单号；30 分钟后 / 换网络 IP 变化 → 查不到（匿名保护设计）
    const fwd = reqHeaders.get('x-forwarded-for')
    const ip = (fwd ? fwd.split(',')[0].trim() : reqHeaders.get('x-real-ip')?.trim()) || 'unknown'
    const since30 = new Date(Date.now() - 30 * 60 * 1000)
    // 2026-08-29 提交前止血：只命中真正匿名单（customerPhone=null）。
    // 此前不带该约束会命中带手机号的单（店内共用 WiFi 出口 IP 相同）→ trackPhone 误判、泄露外送地址、可删他人数据/加菜扣款（乱单根因之一）
    const found = await prisma.order.findFirst({
      where: {
        shopId: shop.id,
        createdAt: { gte: since30 },
        config: { path: ['guestIp'], equals: ip },
        customerPhone: null,
      },
      orderBy: { createdAt: 'desc' },
    })
    if (found) {
      order = found
      ipMatched = true
    }
  }

  // 支付三态（由实收推导）：0=未付，0<实收<total=部分付，≥total=已付
  let payState: 'paid' | 'partial' | 'unpaid' = 'unpaid'
  if (order) {
    const total = Number(order.total)
    const paid = Number(order.paidAmount)
    if (paid > 0 && paid < total) payState = 'partial'
    else if (paid >= total) payState = 'paid'
  }

  // 有效手机号：游客自动匹配用订单里的手机号（可能为空），手动查询用 URL 参数（归一化后）
  const trackPhone = order?.customerPhone ?? normPhone ?? ''

  // 订单类型/桌号/地址（存 order.config，展示用）
  const orderCfg = (order?.config as {
    orderType?: string
    tableNo?: string
    address?: string
  } | null) ?? {}
  const orderType = orderCfg.orderType ?? 'dine_in'

  // 分条件显示（memo §3）：订单未结束（PENDING/IN_PROGRESS/READY）才显示加菜区；
  // READY（待取餐）阶段商品由 getRecommendedProducts 过滤为「可追加」——烧烤摊取餐后加饮料/小菜可行
  const canAddMore =
    order != null && order.status !== 'COMPLETED' && order.status !== 'CANCELLED'
  let addMoreProducts: Awaited<ReturnType<typeof getRecommendedProducts>> = []
  if (canAddMore && order) {
    // 查询门控到条件分支内（notFound/rateLimited 时不白查一次）
    addMoreProducts = await getRecommendedProducts({
      slug,
      locale,
      orderStatus: order.status,
      limit: 60,
    })
  }
  // 加菜区皮肤随店主题（token 化组件自带 theme-<v> 根容器）
  const theme = normalizeTheme((shop.config as { theme?: string } | null)?.theme)

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-3 py-6">
      {/* 「查询订单」标题：未命中订单（表单态）时保留作页面标题；命中订单时并入结果卡作次级标题，避免独立大字突兀（2026-08-31） */}
      {!order && <h1 className="text-center text-2xl font-semibold">{t('title')}</h1>}

      {/* 未登录查单提示（不强制）：登录后一键看本人全部订单（#3）；游客照常按单号/手机号查询 */}
      {!order && !customerId && (
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">{t('loginSuggest')}</p>
      )}

      {/* 查询表单：仅无命中订单时显示（用户反馈：订单已显示详情，上方查询选项隐藏）；
          查失败（notFound/rateLimited）时表单保留可重试，文案在表单下方 */}
      {!order && (
        <form method="GET" className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">{t('phoneOptional')}</span>
            <input
              name="phone"
              type="tel"
              defaultValue={phone ?? ''}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">{t('orderNo')}</span>
            <input
              name="orderNo"
              type="text"
              defaultValue={orderNoStr ?? ''}
              required
              placeholder="CP-260826-001"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>

          <button
            type="submit"
            className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98]"
          >
            {t('submit')}
          </button>
        </form>
      )}

      {notFound && <p className="text-sm text-red-600 dark:text-red-400">{t('notFound')}</p>}

      {notFoundNoPhone && (
        <p className="text-sm text-red-600 dark:text-red-400">{t('notFoundNoPhone')}</p>
      )}

      {rateLimited && <p className="text-sm text-red-600 dark:text-red-400">{t('rateLimited')}</p>}

      {order && (
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-center text-xs uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
            {t('title')}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-lg font-medium">{order.displayNo}</span>
          </div>

          {/* 状态区（顶部状态文字 + 进度条 + 出餐横幅）：单源驱动，见 track-status.tsx；
              pollActive = 有凭证（phone/guestKey/ip）才轮询并显示横幅；无凭证仅静态查看不轮询 */}
          <TrackStatus
            slug={slug}
            orderNo={order.displayNo}
            phone={trackPhone}
            guestKey={guestKey}
            byIp={ipMatched}
            initialStatus={order.status}
            orderType={orderType}
            pollActive={Boolean(trackPhone || guestKey || ipMatched || customerId)}
          />

          {/* 订单类型徽章 + 桌号（堂食）/ 地址（外送）：居中显示（2026-08-29 需求7 变大居中） */}
          <div className="flex flex-wrap items-center justify-center gap-2 text-lg">
            <span className="rounded-full bg-amber-100 px-3 py-1 text-lg font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {t(orderType === 'dine_in' ? 'dineIn' : orderType === 'takeaway' ? 'takeaway' : 'delivery')}
            </span>
            {orderType === 'dine_in' && orderCfg.tableNo && (
              <span className="text-lg text-zinc-600 dark:text-zinc-400">
                {t('tableNo')}: {orderCfg.tableNo}
              </span>
            )}
            {/* 无手机号单（customerPhone=null）不展示外送地址，避免凭订单号枚举泄露敏感信息 */}
            {orderType === 'delivery' && orderCfg.address && order.customerPhone && (
              <span className="text-lg text-zinc-600 dark:text-zinc-400">
                {t('address')}: {orderCfg.address}
              </span>
            )}
          </div>

          {/* 呼叫服务员：堂食店内等餐/加菜时找服务员（用户反馈：track 查单页也要有），订单进行中才显示 */}
          {orderType === 'dine_in' &&
            order.status !== 'COMPLETED' &&
            order.status !== 'CANCELLED' && (
              <CallWaiterButton
                slug={slug}
                tableNo={orderCfg.tableNo}
                phone={trackPhone}
              />
            )}

          <ul className="text-lg text-zinc-600 dark:text-zinc-400">
            {(order.items as unknown as {
              name: string
              qty: number
              price: number
              extras?: { name: string; price: number | string }[]
              options?: { group: string; name: string; price: number | string }[]
              combo?: { name: string; qty: number }[]
            }[]).map((it, idx) => {
              const extrasSum = (it.extras ?? []).reduce((s, e) => s + Number(e.price ?? 0), 0)
              const optionsSum = (it.options ?? []).reduce((s, o) => s + Number(o.price ?? 0), 0)
              const lineTotal = (Number(it.price ?? 0) + extrasSum + optionsSum) * it.qty
              return (
                <li key={idx} className="flex justify-between gap-3">
                  <span className="flex flex-col">
                    <span>{it.name} ×{it.qty}</span>
                    {((it.options?.length ?? 0) > 0 ||
                      (it.extras?.length ?? 0) > 0 ||
                      (it.combo?.length ?? 0) > 0) && (
                      <span className="text-sm text-zinc-400 dark:text-zinc-500">
                        {[
                          ...(it.combo ?? []).map((c) =>
                            c.qty > 1 ? `${c.name}×${c.qty}` : c.name,
                          ),
                          ...(it.options ?? []).map((o) => o.name),
                          ...(it.extras ?? []).map((e) => e.name),
                        ].join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="text-zinc-700 dark:text-zinc-300">{formatPrice(lineTotal, shop.currency)}</span>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center justify-between border-t border-zinc-200 pt-2 dark:border-zinc-700">
            <span className="text-lg font-medium">
              {t('total')}: {formatPrice(Number(order.total), shop.currency)}
            </span>
            <span
              className={
                payState === 'paid'
                  ? 'text-lg font-medium text-green-700 dark:text-green-300'
                  : payState === 'partial'
                    ? 'text-lg font-medium text-amber-700 dark:text-amber-300'
                    : 'text-lg font-medium text-zinc-500'
              }
            >
              {t(payState === 'paid' ? 'paid' : payState === 'partial' ? 'partial' : 'unpaid')}
            </span>
          </div>

          {/* 未结束订单：显示「继续点菜」返回按钮——真正返回点菜页（/{locale}/{vertical}/{slug}）继续点菜，提交时合并进现有订单；
              已结束订单：P2-1 PDPD 一键删除我的数据；无号单新设备无凭证 → 不显示（仅静态查看）；
              ipMatched（IP+30min 兜底命中，可能是他人匿名单）→ 仅静态查看，不显示继续点菜/删除我的数据 */}
          {!ipMatched && (trackPhone || guestKey || customerId) ? (
            order.status !== 'COMPLETED' && order.status !== 'CANCELLED' ? (
              // 继续点菜：跳菜单页带 type 恢复用餐方式、table 恢复桌号、continue 标记加菜目标单
              // （2026-08-29 用户反馈修复：不再锚点滚到下方加菜栏，而是返回真正的点菜页）
              <Link
                href={shopSubUrl({ vertical: shop.vertical, slug, city }, '', {
                  type: orderType,
                  table: orderCfg.tableNo,
                  continue: order.displayNo,
                })}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/40 px-4 py-2.5 text-lg font-medium text-primary transition-colors hover:bg-primary/5"
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
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                {t('continueOrdering')}
              </Link>
            ) : (
              <DeleteMyData
                vertical={shop.vertical}
                slug={slug}
                city={city}
                orderNo={order.displayNo}
                phone={trackPhone}
                guestKey={guestKey}
              />
            )
          ) : null}
        </div>
      )}

      {/* 分条件：订单未结束才显示加菜区；PENDING/IN_PROGRESS 全量、READY 仅「可追加」商品（track 页已过滤）。
          无号单新设备无凭证（无 phone 无 guestKey）→ 不显示加菜区（仅静态查看） */}
      {canAddMore && order && !ipMatched && (trackPhone || guestKey || customerId) && addMoreProducts.length > 0 && (
        <AddMoreMenu
          slug={slug}
          orderNo={order.displayNo}
          phone={trackPhone}
          guestKey={guestKey}
          currency={shop.currency}
          theme={theme}
          products={addMoreProducts}
          orderStatus={order.status}
        />
      )}

      <Link href={shopUrl({ vertical: shop.vertical, slug, city })} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        {t('backToMenu')}
      </Link>
    </main>
  )
}
