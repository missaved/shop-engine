// 中台：平台运营后台（ADMIN 专属，非 ADMIN 自动踢回 /dashboard）
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/dal'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { PlatformStats } from '@/components/admin/platform-stats'
import { ShopList } from '@/components/admin/shop-list'
import { AddShopForm } from '@/components/admin/add-shop-form'

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; vertical?: string; status?: string }>
}) {
  await requireAdmin()
  const t = await getTranslations('admin')
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)
  const q = sp.q ?? ''
  const vertical = sp.vertical ?? 'all'
  const status = sp.status ?? 'all'

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-4">
      {/* 顶栏：平台运营 + 语言切换 */}
      <header className="sticky top-0 z-30 -mx-6 mb-2 flex items-center justify-between border-b border-zinc-100 bg-orange-50/90 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <span className="flex items-center gap-2">
          <span className="text-lg leading-none text-zinc-400">☰</span>
          <span className="text-lg font-semibold">{t('title')}</span>
        </span>
        <LocaleSwitcher />
      </header>

      <PlatformStats />
      <AddShopForm />
      <ShopList page={page} q={q} vertical={vertical} status={status} />
    </main>
  )
}
