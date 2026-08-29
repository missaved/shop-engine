// 顾客端店铺不可用提示（2026-08-29 用户拍板）：
// 维护模式全拦（含查单）/ 入驻审核未通过店，s/[slug] 菜单页与 track 查单页统一渲染。
// 文案走 common namespace（六语言同步）；驳回原因在审核拒绝场景展示。
import { getTranslations } from 'next-intl/server'
import type { ShopUnavailableError } from '@/lib/tenant'

export async function ShopUnavailableView({
  reason,
  rejectReason,
}: {
  reason: ShopUnavailableError['reason']
  rejectReason: string | null
}) {
  const t = await getTranslations('common')
  const isMaintenance = reason === 'maintenance'
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-3 py-16 text-center">
      <div className="text-5xl">{isMaintenance ? '🔧' : '🕐'}</div>
      <h1 className="text-xl font-semibold">
        {t(isMaintenance ? 'maintenanceTitle' : 'notApprovedTitle')}
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t(isMaintenance ? 'maintenanceDesc' : 'notApprovedDesc')}
      </p>
      {!isMaintenance && rejectReason && (
        <p className="mt-1 rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {t('notApprovedReason', { reason: rejectReason })}
        </p>
      )}
    </main>
  )
}
