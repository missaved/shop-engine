// 中台店铺列表：服务端分页 + 服务端查询（搜索/筛选走 Prisma where，不像单店 order-list 全量前端 filter）
// 数据规模地基：店铺随租户线性增长，这里必须服务端分页
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { ShopListActions } from './shop-list-actions'

export type SubStatus = 'trial' | 'active' | 'expired' | 'suspended'

// 订阅状态推导（单点）：停用 > 到期 > 试用 > 活跃
export function subStatus(shop: {
  plan: string
  subscribedUntil: Date | null
  platformSuspended: boolean
}): SubStatus {
  if (shop.platformSuspended) return 'suspended'
  if (shop.subscribedUntil && shop.subscribedUntil.getTime() < Date.now()) return 'expired'
  if (shop.plan === 'TRIAL') return 'trial'
  return 'active'
}

const PAGE_SIZE = 20

const VERTICALS = ['FOOD', 'MOTO', 'SALON', 'PET', 'LAUNDRY'] as const
type VerticalValue = (typeof VERTICALS)[number]

// 订阅状态 → Prisma where（与 subStatus 判定一致，4 类互斥；pending = 入驻审核待审，独立维度）
function statusWhere(status: string): Prisma.ShopWhereInput | null {
  const now = new Date()
  const notExpired: Prisma.ShopWhereInput[] = [
    { subscribedUntil: null },
    { subscribedUntil: { gte: now } },
  ]
  switch (status) {
    case 'trial':
      return { platformSuspended: false, plan: 'TRIAL', OR: notExpired }
    case 'active':
      return { platformSuspended: false, plan: { not: 'TRIAL' }, OR: notExpired }
    case 'expired':
      return { platformSuspended: false, subscribedUntil: { lt: now } }
    case 'suspended':
      return { platformSuspended: true }
    case 'pending':
      // 入驻审核待审（2026-08-29）：approved=false 的新店，独立于订阅状态筛选
      return { approved: false }
    default:
      return null
  }
}

const SUB_KEY: Record<SubStatus, string> = {
  trial: 'subTrial',
  active: 'subActive',
  expired: 'subExpired',
  suspended: 'subSuspended',
}

function badgeClass(st: SubStatus): string {
  switch (st) {
    case 'trial':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    case 'active':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
    case 'expired':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    case 'suspended':
      return 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
  }
}

export async function ShopList({
  page,
  q,
  vertical,
  status,
}: {
  page: number
  q: string
  vertical: string
  status: string
}) {
  const t = await getTranslations('admin')

  const where: Prisma.ShopWhereInput = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { slug: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(vertical && vertical !== 'all'
      ? { vertical: vertical as VerticalValue }
      : {}),
    ...(statusWhere(status) ?? {}),
  }

  const [shops, total] = await Promise.all([
    prisma.shop.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { orders: true, products: true } },
        // 老板账号（登录失败锁定后台解锁用）：卡片显示锁定徽章 + 解锁按钮
        users: {
          where: { role: 'OWNER' },
          select: { id: true, failedAttempts: true, lockedUntil: true },
        },
      },
    }),
    prisma.shop.count({ where }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // 分页链接保留 q/vertical/status 筛选参数
  const extraQs = [
    q ? `q=${encodeURIComponent(q)}` : '',
    vertical && vertical !== 'all' ? `vertical=${vertical}` : '',
    status && status !== 'all' ? `status=${status}` : '',
  ]
    .filter(Boolean)
    .join('&')

  return (
    <section className="flex flex-col gap-3">
      {/* 搜索 + 筛选（GET 表单，服务端查询） */}
      <form method="get" className="flex flex-wrap gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder={t('searchPlaceholder')}
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        />
        <select
          name="vertical"
          defaultValue={vertical || 'all'}
          className="rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="all">{t('allVerticals')}</option>
          {VERTICALS.map((v) => (
            <option key={v} value={v}>
              {t(`vertical${v.charAt(0)}${v.slice(1).toLowerCase()}`)}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status || 'all'}
          className="rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="all">{t('allStatus')}</option>
          <option value="trial">{t('subTrial')}</option>
          <option value="active">{t('subActive')}</option>
          <option value="expired">{t('subExpired')}</option>
          <option value="suspended">{t('subSuspended')}</option>
          <option value="pending">{t('subPending')}</option>
        </select>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {t('search')}
        </button>
      </form>

      {/* 卡片列表 */}
      {shops.length === 0 ? (
        <p className="text-sm text-zinc-500">{t('empty')}</p>
      ) : (
        shops.map((s) => {
          const st = subStatus(s)
          // 老板账号锁定状态（登录失败锁定后台解锁）：lockedUntil 未过即视为锁定
          const owner = s.users[0]
          const ownerLocked = !!owner?.lockedUntil && owner.lockedUntil.getTime() > Date.now()
          return (
            <div
              key={s.id}
              className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold">{s.name}</span>
                  {s.featured && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      {t('featured')}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* 入驻审核状态（2026-08-29）：approved=false 显示「待审」，被驳回带原因 */}
                  {!s.approved && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      {t('subPending')}
                    </span>
                  )}
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(st)}`}
                  >
                    {t(SUB_KEY[st])}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                <span>{s.slug}</span>
                <span>
                  {t(`vertical${s.vertical.charAt(0)}${s.vertical.slice(1).toLowerCase()}`)}
                </span>
                <span>{s.open ? t('shopOpen') : t('shopClosed')}</span>
                <span>
                  {s.subscribedUntil
                    ? t('expiresAt', { date: s.subscribedUntil.toISOString().slice(0, 10) })
                    : t('noExpiry')}
                </span>
                <span>{t('ordersCount', { n: s._count.orders })}</span>
                <span>{t('productsCount', { n: s._count.products })}</span>
              </div>
              {/* 被驳回原因（审核未通过时展示，供老板/中台对照） */}
              {!s.approved && s.rejectReason && (
                <p className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  {t('rejectReason')}: {s.rejectReason}
                </p>
              )}
              <ShopListActions
                shopId={s.id}
                slug={s.slug}
                plan={s.plan}
                suspended={s.platformSuspended}
                featured={s.featured}
                approved={s.approved}
                ownerLocked={ownerLocked}
                ownerId={owner?.id}
              />
            </div>
          )
        })
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <a
            href={page > 1 ? `?page=${page - 1}${extraQs ? `&${extraQs}` : ''}` : undefined}
            className={
              page > 1
                ? 'rounded-md border border-zinc-300 px-3 py-1.5 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'
                : 'pointer-events-none rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700'
            }
          >
            {t('prev')}
          </a>
          <span className="text-zinc-500">{t('pageInfo', { page, total })}</span>
          <a
            href={page < totalPages ? `?page=${page + 1}${extraQs ? `&${extraQs}` : ''}` : undefined}
            className={
              page < totalPages
                ? 'rounded-md border border-zinc-300 px-3 py-1.5 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'
                : 'pointer-events-none rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700'
            }
          >
            {t('next')}
          </a>
        </div>
      )}
    </section>
  )
}
