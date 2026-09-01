// 公开自助开店申请页：/{locale}/open（2026-09-01 #4）。游客自助提交 → 建待审店 → 后台审核。
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { OpenShopForm } from '@/components/shop/open-shop-form'

export default async function OpenShopPage() {
  const t = await getTranslations('open')
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <h1 className="text-center text-2xl font-semibold">{t('title')}</h1>
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
      <OpenShopForm />
      <Link href="/" className="text-center text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        {t('backHome')}
      </Link>
    </main>
  )
}
