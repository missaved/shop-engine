'use client'
// LAUNDRY 老板端一页后台：今日统计 + 待取催取 + 订单列表 + 设置配价
// 视图：home（统计+待办+订单）→ order（三模式快速开单）/ settings（配价）
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { LaundryShop } from './types'
import { LaundryStats } from './laundry-stats'
import { LaundryOrders } from './laundry-orders'
import { LaundryReminderList } from './laundry-reminder-list'
import { QuickLaundry } from './quick-laundry'
import { LaundrySettings } from './laundry-settings'
import { LaundryCustomers } from './laundry-customers'

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
  const [view, setView] = useState<'home' | 'order' | 'settings' | 'customers'>('home')

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-4">
      {subscriptionExpired && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {td('subscriptionExpired')}
        </div>
      )}
      <header className="sticky top-0 z-30 -mx-6 mb-2 flex items-center justify-between border-b border-zinc-100 bg-orange-50/90 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex items-center gap-2">
          {view !== 'home' && (
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
          {view === 'home' && (
            <>
              <button
                onClick={() => setView('order')}
                className="rounded-full bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm"
              >
                + {t('createOrder')}
              </button>
              <button
                onClick={() => setView('settings')}
                aria-label={t('settings')}
                className="rounded-full border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-zinc-700"
              >
                ⚙️
              </button>
              <button
                onClick={() => setView('customers')}
                aria-label={t('customers')}
                className="rounded-full border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-zinc-700"
              >
                👥
              </button>
            </>
          )}
          <button
            onClick={async () => {
              if (confirm('退出登录？')) await onLogout()
            }}
            className="text-sm text-zinc-500"
          >
            {t('cancel')}
          </button>
        </div>
      </header>

      {view === 'home' && (
        <>
          <LaundryStats currency={shop.currency} />
          <LaundryReminderList shopName={shop.name} />
          <LaundryOrders currency={shop.currency} shop={shop} />
        </>
      )}

      {view === 'order' && (
        <QuickLaundry shop={shop} onDone={() => setView('home')} onBack={() => setView('home')} />
      )}

      {view === 'settings' && <LaundrySettings shop={shop} />}
      {view === 'customers' && <LaundryCustomers currency={shop.currency} />}
    </main>
  )
}
