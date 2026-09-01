'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { LogoutButton } from '@/components/admin/logout-button'
import { ThemeToggle } from '@/components/admin/theme-toggle'

// admin 后台外壳（第 20 批 A5）：纯桌面固定左栏导航（管理员电脑用，不做移动折叠）
// 菜单分组：运营 / 营收 / 内容 / 系统。新增垂直或板块时在对应组加一项即可挂载
const NAV_GROUPS = [
  {
    labelKey: 'navGroupOps',
    items: [
      { rel: '', key: 'navOverview' },
      { rel: '/shops', key: 'navShops' },
    ],
  },
  {
    labelKey: 'navGroupRevenue',
    items: [
      { rel: '/analytics', key: 'navAnalytics' },
      { rel: '/orders', key: 'navOrders' },
      { rel: '/customers', key: 'navCustomers' },
    ],
  },
  {
    labelKey: 'navGroupContent',
    items: [
      { rel: '/presets', key: 'navPresets' },
      // M4.4 moto 中台预设库（MotoPreset 独立页）
      { rel: '/moto-presets', key: 'navMotoPresets' },
    ],
  },
  {
    labelKey: 'navGroupSystem',
    items: [{ rel: '/settings', key: 'navSettings' }],
  },
]

export function AdminShell({
  children,
  siteName,
  siteLogo,
}: {
  children: React.ReactNode
  siteName: string | null
  siteLogo: string | null
}) {
  const t = useTranslations('admin')
  // admin 树 locale 在第 2 段（/admin/{locale}），从 useParams 取；路径手动拼 /admin/{locale}/...
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'
  const pathname = usePathname()

  function hrefOf(rel: string) {
    return `/admin/${locale}${rel}`
  }

  function isActive(rel: string) {
    const href = hrefOf(rel)
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <div className="flex min-h-screen">
      {/* 纯桌面固定侧边栏（管理端电脑用，不做移动端抽屉） */}
      <aside className="fixed inset-y-0 left-0 flex w-56 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          {siteLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={siteLogo} alt="" className="h-6 w-6 rounded object-cover" />
          ) : (
            <span className="text-lg leading-none text-amber-500">☰</span>
          )}
          <span className="truncate text-lg font-semibold">{siteName ?? t('title')}</span>
          <span className="ml-auto">
            <ThemeToggle />
          </span>
        </div>

        <nav className="flex flex-col gap-3 p-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.labelKey} className="flex flex-col gap-1">
              <p className="px-3 pt-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {t(group.labelKey)}
              </p>
              {group.items.map((item) => (
                <Link
                  key={item.rel}
                  href={hrefOf(item.rel)}
                  className={`rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive(item.rel)
                      ? 'bg-amber-500/10 font-medium text-amber-600 dark:text-amber-400'
                      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  {t(item.key)}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
          <LogoutButton />
        </div>
      </aside>

      {/* 内容区：左栏让位 pl-56；全屏铺满（去掉 max-w 居中约束，页面自动撑满右侧） */}
      <main className="flex-1 pl-56 bg-zinc-100 dark:bg-zinc-950">
        <div className="w-full px-8 pb-8 pt-8">{children}</div>
      </main>
    </div>
  )
}
