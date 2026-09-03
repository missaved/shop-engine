'use client'
// LAUNDRY 老板端一页后台：今日统计 + 待取催取 + 订单列表 + 设置配价
// 顶层（home）只放核心（统计+订单+提醒）；设置/会员/退出收进 ☰ 抽屉（照 food）
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { LaundryShop } from './types'
import { LaundryStats } from './laundry-stats'
import { LaundryOrders } from './laundry-orders'
import { LaundryReminderList } from './laundry-reminder-list'
import { QuickLaundry } from './quick-laundry'
import { LaundrySettings } from './laundry-settings'
import { LaundryCustomers } from './laundry-customers'
import { LaundryActiveCount } from './laundry-active-count'
import { BackToTop } from '@/components/dashboard/back-to-top'
import { SideDrawer } from '@/components/dashboard/side-drawer'

export function LaundryDashboard({
  shop,
  subscriptionExpired,
  onLogout,
}: {
  shop: LaundryShop
  subscriptionExpired: boolean
  onLogout: () => Promise<void>
}) {
  const t = useTranslations('laundry')
  const td = useTranslations('dashboard')
  const [view, setView] = useState<'home' | 'order'>('home')

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-4">
      {subscriptionExpired && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {td('subscriptionExpired')}
        </div>
      )}
      <header className="sticky top-0 z-30 -mx-6 mb-2 flex items-center justify-between border-b border-zinc-100 bg-orange-50/90 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex items-center gap-2">
          {view === 'order' && (
            <button
              onClick={() => setView('home')}
              className="mr-1 text-lg text-zinc-400"
              aria-label={t('back')}
            >
              ←
            </button>
          )}
          <span className="text-lg font-semibold">{shop.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <LaundryActiveCount />
          <SideDrawer
            trigger={
              <button type="button" className="flex items-center gap-1 rounded-md px-1 py-1 text-lg leading-none text-zinc-400" aria-label={t('menu')}>☰</button>
            }
            title={<span>{shop.name}</span>}
          >
            <div className="flex flex-col gap-4">
              <LaundrySettings shop={shop} onLogout={onLogout} />
              <LaundryCustomers currency={shop.currency} />
            </div>
          </SideDrawer>
        </div>
      </header>

      {view === 'home' && (
        <>
          <button
            onClick={() => setView('order')}
            className="self-start rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm"
          >
            + {t('createOrder')}
          </button>
          <LaundryStats currency={shop.currency} />
          <LaundryOrders currency={shop.currency} shop={shop} />
          <LaundryReminderList shopName={shop.name} />
        </>
      )}

      {view === 'order' && (
        <QuickLaundry shop={shop} onDone={() => setView('home')} onBack={() => setView('home')} />
      )}
      <BackToTop />
    </main>
  )
}
