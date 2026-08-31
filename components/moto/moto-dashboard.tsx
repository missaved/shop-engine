'use client'
// moto 老板端一页后台：车牌搜索（核心入口）+ 今日维修单 + 开单向导
// 视图：home（搜索+订单）→ vehicle（档案履历）/ order（7 步开单向导）
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { PlateSearch } from './plate-search'
import { PlateCamera } from './plate-camera'
import { VehicleDetail } from './vehicle-detail'
import { VehicleForm } from './vehicle-form'
import { QuickOrder } from './quick-order'
import { MotoOrders } from './moto-orders'
import { MotoReminderList } from './moto-reminder-list'
import { MotoStats } from './moto-stats'
import { MotoLedger } from './moto-ledger'
import { MotoSettings } from './moto-settings'
import type { MotoShop, VehiclePlain } from './types'

export function MotoDashboard({
  shop,
  subscriptionExpired,
  onLogout,
}: {
  shop: MotoShop
  subscriptionExpired: boolean
  onLogout: () => Promise<void>
}) {
  const t = useTranslations('moto')
  // 订阅到期横幅（M5.2b 垂直无关链路）：与 food 老板端同文案，dashboard namespace
  const td = useTranslations('dashboard')
  const [view, setView] = useState<'home' | 'vehicle' | 'order' | 'settings'>('home')
  const [vehicle, setVehicle] = useState<VehiclePlain | null>(null)
  const [editing, setEditing] = useState(false)
  const [plate, setPlate] = useState('')

  const openOrder = (v: VehiclePlain | null, p: string) => {
    setVehicle(v)
    setPlate(p)
    setView('order')
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-4">
      {/* 订阅到期横幅（与 food 老板端一致）：订阅到期后顶部提示联系平台续费 */}
      {subscriptionExpired && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {td('subscriptionExpired')}
        </div>
      )}
      {/* 顶栏：店名 + 新开单 + 退出 */}
      <header className="sticky top-0 z-30 -mx-6 mb-2 flex items-center justify-between border-b border-zinc-100 bg-orange-50/90 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex items-center gap-2">
          {view !== 'home' && (
            <button
              onClick={() => {
                setView('home')
                setEditing(false)
              }}
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
                onClick={() => openOrder(null, '')}
                className="rounded-full bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm"
              >
                + {t('createOrder')}
              </button>
              {/* M4.3 设置入口 */}
              <button
                onClick={() => setView('settings')}
                aria-label={t('settings')}
                className="rounded-full border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-zinc-700"
              >
                ⚙️
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
          {/* M4.1 概览卡：今日实收 / 待取 / 待提醒 / 欠款 */}
          <MotoStats currency={shop.currency} />
          <PlateSearch
            onFound={(v) => {
              setVehicle(v)
              setView('vehicle')
            }}
            onNotFound={(p) => openOrder(null, p)}
          />
          <PlateCamera
            hint={t('cameraHint')}
            onResult={(r) => {
              if (r.plate) openOrder(null, r.plate)
            }}
          />
          <MotoReminderList shopName={shop.name} />
          <MotoOrders vertical={shop.vertical} slug={shop.slug} currency={shop.currency} city={shop.city} />
          {/* M4.2 流水视图：按日收入 / 欠款 / 收回 */}
          <MotoLedger currency={shop.currency} />
        </>
      )}

      {view === 'settings' && (
        <MotoSettings
          shop={shop}
          onSaved={() => {
            /* 数据均走 server action + client 轮询，保存后无需额外刷新 */
          }}
        />
      )}

      {view === 'vehicle' &&
        (editing ? (
          <VehicleForm
            initial={vehicle}
            onSaved={(v) => {
              setVehicle(v)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          vehicle && (
            <VehicleDetail
              vehicle={vehicle}
              currency={shop.currency}
              onBack={() => setView('home')}
              onEdit={() => setEditing(true)}
              onCreateOrder={(v) => openOrder(v, v.plate)}
            />
          )
        ))}

      {view === 'order' && (
        <QuickOrder
          shop={shop}
          initialVehicle={vehicle}
          initialPlate={plate}
          onDone={() => {
            setView('home')
            setVehicle(null)
          }}
          onBack={() => setView('home')}
        />
      )}
    </main>
  )
}
