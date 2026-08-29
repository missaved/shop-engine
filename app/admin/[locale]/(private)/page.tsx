// 中台总览：平台运营后台（ADMIN 专属；requireAdmin + TOTP 绑定检查由 (private)/layout.tsx 统一处理）
// 内容区块分配：只放平台统计 + 快捷入口；建店/店铺列表已迁至「店铺管理」页
// locale 直接用 URL params：admin 树脱离 intl 中间件，getLocale() 在部分请求会回退 defaultLocale(en)，params 是唯一可信来源
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { PlatformStats } from '@/components/admin/platform-stats'

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('admin')

  // 快捷入口：三大运营页 + 预设（链接为绝对 admin 路径 /admin/{locale}/...）
  const QUICK = [
    { rel: '/shops', key: 'navShops', icon: '🛠️' },
    { rel: '/analytics', key: 'navAnalytics', icon: '📊' },
    { rel: '/orders', key: 'navOrders', icon: '🧾' },
    { rel: '/customers', key: 'navCustomers', icon: '👥' },
    { rel: '/presets', key: 'navPresets', icon: '📚' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PlatformStats />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t('quickTitle')}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {QUICK.map((q) => (
            <Link
              key={q.rel}
              href={`/admin/${locale}${q.rel}`}
              className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-sm transition-colors hover:border-amber-300 hover:bg-amber-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-amber-700 dark:hover:bg-amber-900/20"
            >
              <span className="text-xl leading-none">{q.icon}</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-200">{t(q.key)}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
