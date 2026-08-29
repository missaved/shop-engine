import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { requireAdmin } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import type { Prisma, OrderStatus } from '@/generated/prisma/client'

// 订单明细（第 20 批阶段五）：跨店订单，店铺 / 状态筛选 + 分页（每页 20）
const PAGE_SIZE = 20

const STATUSES: OrderStatus[] = ['PENDING', 'IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELLED']

// 订单状态枚举 → i18n key 后缀：IN_PROGRESS → InProgress（下划线转驼峰 + 首字母大写）。
// 直接用 charAt(0)+slice(1).toLowerCase() 会把 IN_PROGRESS 拼成 In_progress → key statusIn_progress，
// 与 messages 里已定义的 statusInProgress 不匹配，触发 MISSING_MESSAGE（订单页中英混杂）
const statusKey = (s: string): string => {
  const cc = s.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  return cc.charAt(0).toUpperCase() + cc.slice(1)
}

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ shopId?: string; status?: string; page?: string }>
}) {
  await requireAdmin()
  const t = await getTranslations('admin')
  const { locale } = await params
  const q = await searchParams

  const shopId = q.shopId && q.shopId !== '' ? q.shopId : undefined
  const status = STATUSES.includes(q.status as OrderStatus) ? (q.status as OrderStatus) : undefined
  const page = Math.max(1, Number(q.page) || 1)

  const where: Prisma.OrderWhereInput = {
    ...(shopId ? { shopId } : {}),
    ...(status ? { status } : {}),
  }

  const [shops, orders, total] = await Promise.all([
    prisma.shop.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.order.findMany({
      where,
      include: { shop: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.order.count({ where }),
  ])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })

  // 筛选条件带进分页链接
  const qs = (p: number) => {
    const sp = new URLSearchParams()
    if (shopId) sp.set('shopId', shopId)
    if (status) sp.set('status', status)
    sp.set('page', String(p))
    return sp.toString()
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">{t('ordersTitle')}</h1>
        <p className="text-sm text-zinc-500">{t('ordersHint')}</p>
      </header>

      {/* 筛选（GET 表单，保留在 URL 便于分享/回退） */}
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">{t('colShop')}</span>
          <select
            name="shopId"
            defaultValue={shopId ?? ''}
            className="min-w-48 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">{t('filterAllShops')}</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">{t('colStatus')}</span>
          <select
            name="status"
            defaultValue={status ?? ''}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">{t('filterAllStatus')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status${statusKey(s)}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {t('search')}
        </button>
      </form>

      {/* 订单表 */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-100 text-left text-xs text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">{t('colDisplayNo')}</th>
              <th className="px-4 py-3 font-medium">{t('colShop')}</th>
              <th className="px-4 py-3 font-medium">{t('colCustomer')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('colTotal')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('colPaid')}</th>
              <th className="px-4 py-3 font-medium">{t('colStatus')}</th>
              <th className="px-4 py-3 font-medium">{t('colTime')}</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-zinc-400">
                  {t('noOrders')}
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr
                key={o.id}
                className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/60 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
              >
                <td className="px-4 py-3 font-mono text-xs">{o.displayNo}</td>
                <td className="px-4 py-3">{o.shop.name}</td>
                <td className="px-4 py-3">
                  {o.customerName ?? o.customerPhone ?? '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(Number(o.total))}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-500">
                  {fmt(Number(o.paidAmount))}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {t(`status${statusKey(o.status)}`)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">
                  {o.createdAt.toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">{t('pageInfo', { page, total: pages })}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin/${locale}/orders?${qs(page - 1)}`}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t('prev')}
              </Link>
            )}
            {page < pages && (
              <Link
                href={`/admin/${locale}/orders?${qs(page + 1)}`}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t('next')}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
