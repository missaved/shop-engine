// 聚合卡（垂直列表 / 城市门户共用）：一店一行，title + 可选 subtitle + 营业态徽章。
// 纯展示（server 组件）：卡片数据由调用方用 vertical-modules aggregation.card 投影，本组件不查 DB。
import { Link } from '@/i18n/navigation'
import { shopUrl } from '@/lib/urls'
import type { Vertical } from '@/lib/vertical'
import type { AggCard } from '@/lib/vertical-modules'

export function ShopCard({
  card,
  vertical,
  city,
  openLabel,
  closedLabel,
  suspendedLabel,
  expiredLabel,
}: {
  card: AggCard
  vertical: Vertical
  city: string
  openLabel: string
  closedLabel: string
  suspendedLabel: string
  expiredLabel: string
}) {
  return (
    <Link
      href={shopUrl({ vertical, slug: card.slug, city })}
      className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-lg font-medium">{card.title}</span>
        {card.subtitle && (
          <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">{card.subtitle}</span>
        )}
      </span>
      <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
        {card.badge === 'open'
          ? openLabel
          : card.badge === 'suspended'
            ? suspendedLabel
            : card.badge === 'expired'
              ? expiredLabel
              : closedLabel}
      </span>
    </Link>
  )
}
