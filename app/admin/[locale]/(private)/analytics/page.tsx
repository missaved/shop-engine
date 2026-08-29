import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/dal'
import { prisma } from '@/lib/prisma'
import { RevenueChart } from '@/components/admin/revenue-chart'
import type { Prisma } from '@/generated/prisma/client'

// 营收看板（第 20 批阶段五）：跨店聚合，本月 + 累计并排，欠款单列，近 30 天趋势图（recharts）
// 营收口径：非取消单的 total 计营收；欠款 = total - paidAmount（paidAmount < total 的部分付/未付）
export default async function AnalyticsPage() {
  await requireAdmin()
  const t = await getTranslations('admin')

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const daysAgo30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const whereValid: Prisma.OrderWhereInput = { status: { not: 'CANCELLED' } }

  const [monthAgg, totalAgg, owedAgg, orderCount, trendRows] = await Promise.all([
    prisma.order.aggregate({
      _sum: { total: true },
      where: { ...whereValid, createdAt: { gte: monthStart } },
    }),
    prisma.order.aggregate({ _sum: { total: true }, where: whereValid }),
    // 欠款：实收 < 应付的差额合计（SQL 端减法，避免全量拉取 JS 聚合）
    prisma.$queryRaw<{ owed: number | null }[]>`
      SELECT SUM(total - "paidAmount") AS owed
      FROM "Order"
      WHERE status <> 'CANCELLED' AND "paidAmount" < total`,
    prisma.order.count({ where: whereValid }),
    prisma.order.findMany({
      where: { ...whereValid, createdAt: { gte: daysAgo30 } },
      select: { total: true, createdAt: true },
    }),
  ])

  // Decimal → number 展示
  const month = Number(monthAgg._sum.total ?? 0)
  const total = Number(totalAgg._sum.total ?? 0)
  const owed = Number(owedAgg[0]?.owed ?? 0)

  // 近 30 天按日聚合（30 天量级，JS 聚合足够）
  const byDay = new Map<string, number>()
  for (const row of trendRows) {
    const day = row.createdAt.toISOString().slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + Number(row.total))
  }
  const trend = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now.getTime() - (29 - i) * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    return { day: key.slice(5), total: Math.round((byDay.get(key) ?? 0) * 100) / 100 }
  })

  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })

  const cards = [
    { label: t('revMonth'), value: fmt(month) },
    { label: t('revTotal'), value: fmt(total) },
    { label: t('revOwed'), value: fmt(owed), warn: owed > 0 },
    { label: t('orderCount'), value: String(orderCount) },
  ]

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">{t('analyticsTitle')}</h1>
        <p className="text-sm text-zinc-500">{t('analyticsHint')}</p>
      </header>

      {/* 统计卡片：本月 / 累计 / 欠款（单列）/ 订单数 */}
      <div className="grid grid-cols-4 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="text-sm text-zinc-500">{c.label}</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                c.warn ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-50'
              }`}
            >
              {c.value}
            </p>
          </div>
        ))}
      </div>

      {/* 近 30 天营收趋势（recharts） */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
          {t('trendTitle')}
        </p>
        <RevenueChart data={trend} />
      </div>
    </div>
  )
}
