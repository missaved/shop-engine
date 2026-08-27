// 客户侧查单页：/s/[slug]/track?phone=..&orderNo=..（GET 表单，结果可刷新/分享）
import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getShopBySlug } from '@/lib/tenant'
import { isRateLimited, recordFailure } from '@/lib/rate-limit'
import { Link } from '@/i18n/navigation'
import { DeleteMyData } from '@/components/shop/delete-my-data'
import { formatPrice } from '@/lib/format'

// 订单状态 → 本地化 key（track 段）
const STATUS_KEY: Record<string, string> = {
  PENDING: 'statusPending',
  IN_PROGRESS: 'statusInProgress',
  READY: 'statusReady',
  COMPLETED: 'statusCompleted',
  CANCELLED: 'statusCancelled',
}

export default async function TrackOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ orderNo?: string; phone?: string }>
}) {
  const { slug } = await params
  const { orderNo: orderNoStr, phone } = await searchParams
  const t = await getTranslations('track')

  const shop = await getShopBySlug(slug)

  let order: Awaited<ReturnType<typeof prisma.order.findFirst>> = null
  let notFound = false
  let rateLimited = false

  // 查单：对外订单号 displayNo（CP-YYMMDD-NNN）+ 手机号
  const no = orderNoStr?.trim()
  if (no && phone) {
    // P0-4 查单限流：IP + 手机号双维度，防枚举（复用登录限流同一套计数，5 次失败/60s）
    const h = await headers()
    const fwd = h.get('x-forwarded-for')
    const ip = (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip')?.trim()) || 'unknown'
    const keyIp = `track:ip:${ip}`
    const keyPhone = `track:phone:${phone.trim()}`
    if (isRateLimited(keyIp) || isRateLimited(keyPhone)) {
      rateLimited = true
    } else {
      const found = await prisma.order.findFirst({
        where: { shopId: shop.id, displayNo: no, customerPhone: phone.trim() },
      })
      if (found) {
        order = found
      } else {
        notFound = true
        recordFailure(keyIp)
        recordFailure(keyPhone)
      }
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

  // 订单类型/桌号/地址（存 order.config，展示用）
  const orderCfg = (order?.config as {
    orderType?: string
    tableNo?: string
    address?: string
  } | null) ?? {}
  const orderType = orderCfg.orderType ?? 'dine_in'

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-8">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <form method="GET" className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{t('phone')}</span>
          <input
            name="phone"
            type="tel"
            defaultValue={phone ?? ''}
            required
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
          className="rounded-md bg-amber-500 px-4 py-2 text-sm text-white transition-colors hover:bg-amber-600 dark:bg-amber-500 dark:text-white"
        >
          {t('submit')}
        </button>
      </form>

      {notFound && <p className="text-sm text-red-600 dark:text-red-400">{t('notFound')}</p>}

      {rateLimited && <p className="text-sm text-red-600 dark:text-red-400">{t('rateLimited')}</p>}

      {order && (
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="font-medium">{order.displayNo}</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {t(STATUS_KEY[order.status] ?? 'statusPending')}
            </span>
          </div>

          {/* 订单类型徽章 + 桌号（堂食）/ 地址（外送） */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {orderType === 'dine_in' ? '🪑 ' : orderType === 'takeaway' ? '🛍️ ' : '🛵 '}
              {t(orderType === 'dine_in' ? 'dineIn' : orderType === 'takeaway' ? 'takeaway' : 'delivery')}
            </span>
            {orderType === 'dine_in' && orderCfg.tableNo && (
              <span className="text-zinc-600 dark:text-zinc-400">
                {t('tableNo')}: {orderCfg.tableNo}
              </span>
            )}
            {orderType === 'delivery' && orderCfg.address && (
              <span className="text-zinc-600 dark:text-zinc-400">
                {t('address')}: {orderCfg.address}
              </span>
            )}
          </div>

          <ul className="text-sm text-zinc-600 dark:text-zinc-400">
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
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
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
                  <span className="text-zinc-700 dark:text-zinc-300">{formatPrice(lineTotal)}đ</span>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center justify-between border-t border-zinc-200 pt-2 dark:border-zinc-700">
            <span className="text-sm font-medium">
              {t('total')}: {formatPrice(Number(order.total))}đ
            </span>
            <span
              className={
                payState === 'paid'
                  ? 'text-sm font-medium text-green-700 dark:text-green-300'
                  : payState === 'partial'
                    ? 'text-sm font-medium text-amber-700 dark:text-amber-300'
                    : 'text-sm font-medium text-zinc-500'
              }
            >
              {t(payState === 'paid' ? 'paid' : payState === 'partial' ? 'partial' : 'unpaid')}
            </span>
          </div>

          {/* P2-1 PDPD 一键删除我的数据 */}
          <DeleteMyData
            slug={slug}
            orderNo={order.displayNo}
            phone={phone?.trim() ?? ''}
          />
        </div>
      )}

      <Link href={`/s/${slug}`} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        {t('backToMenu')}
      </Link>
    </main>
  )
}
