// 垂直聚合页（分类页）：/{vertical}。阶段 3 内容，本期仅占位。
// 段数约定：`/food` → 本页；`/food/{slug}` → [vertical]/[slug] 单店页（Next 按段数区分，不冲突）。
// 非合法垂直短码（如老式 /en/{slug}）→ 404。
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseVerticalSlug, verticalSlug } from '@/lib/vertical'

export default async function VerticalHomePage({
  params,
}: {
  params: Promise<{ locale: string; vertical: string }>
}) {
  const { vertical: verticalParam } = await params
  const vertical = parseVerticalSlug(verticalParam)
  if (!vertical) notFound()
  // 占位文案：复用 `admin.comingSoon`（六语「即将开放」均正确；common 无此 key，阶段 3 实做时再入驻垂直专属 ns）
  const t = await getTranslations('admin')
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <h1 className="text-center text-3xl font-bold">{verticalSlug(vertical)}</h1>
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('comingSoon')}
      </p>
    </main>
  )
}
