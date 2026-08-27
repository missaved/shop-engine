// 平台看板：三卡（总店/总订单/总商品）+ 订阅概况四格（试用/活跃/到期/停用）
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { subStatus, type SubStatus } from './shop-list'

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white p-3 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-2xl font-semibold text-amber-600 dark:text-amber-500">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  )
}

export async function PlatformStats() {
  const t = await getTranslations('admin')
  const [totalShops, totalOrders, totalProducts, shops] = await Promise.all([
    prisma.shop.count(),
    prisma.order.count(),
    prisma.product.count(),
    prisma.shop.findMany({
      select: { plan: true, subscribedUntil: true, platformSuspended: true },
    }),
  ])

  const subCounts: Record<SubStatus, number> = {
    trial: 0,
    active: 0,
    expired: 0,
    suspended: 0,
  }
  for (const s of shops) subCounts[subStatus(s)]++

  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <StatCard value={totalShops} label={t('totalShops')} />
        <StatCard value={totalOrders} label={t('totalOrders')} />
        <StatCard value={totalProducts} label={t('totalProducts')} />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {(['trial', 'active', 'expired', 'suspended'] as const).map((k) => (
          <div
            key={k}
            className="flex flex-col items-center rounded-xl border border-zinc-200 bg-white p-2 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="text-lg font-semibold text-amber-600 dark:text-amber-500">
              {subCounts[k]}
            </p>
            <p className="text-xs text-zinc-500">
              {t(`sub${k.charAt(0).toUpperCase()}${k.slice(1)}`)}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
