// 中台店铺管理：折叠建店表单 + 服务端搜索/筛选/分页列表（ADMIN 专属）
// 内容区块分配：建店表单收进 <details> 折叠，默认收起，不挤占列表；表单提交后 server action + refresh 自动更新
import { getTranslations } from 'next-intl/server'
import { AddShopForm } from '@/components/admin/add-shop-form'
import { ShopList } from '@/components/admin/shop-list'

export default async function AdminShopsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; vertical?: string; status?: string }>
}) {
  const t = await getTranslations('admin')
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)
  const q = sp.q ?? ''
  const vertical = sp.vertical ?? 'all'
  const status = sp.status ?? 'all'

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t('shopsTitle')}</h1>
        <p className="text-xs text-zinc-500">{t('shopsHint')}</p>
      </div>

      {/* 折叠建店表单：默认收起，避免与列表抢空间 */}
      <details className="group rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>{t('addShopToggle')}</span>
          <span className="text-zinc-400 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">
          <AddShopForm />
        </div>
      </details>

      <ShopList page={page} q={q} vertical={vertical} status={status} />
    </div>
  )
}
