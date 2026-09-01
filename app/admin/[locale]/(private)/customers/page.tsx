import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

// 客户台账（第 20 批阶段五）：按手机号聚合客户，跨店累计消费 / 欠款 / 单数
// 口径：非取消单；欠款 = total - paidAmount（实收 < 应付）
type CustomerRow = {
  phone: string
  name: string | null
  cnt: number
  spend: number
  owed: number
}

export default async function CustomersPage() {
  await requireAdmin()
  const t = await getTranslations('admin')

  const rows = await prisma.$queryRaw<CustomerRow[]>`
    SELECT "customerPhone" AS phone,
           MAX("customerName") AS name,
           COUNT(*) AS cnt,
           SUM(total) AS spend,
           SUM(CASE WHEN "paidAmount" < total THEN total - "paidAmount" ELSE 0 END) AS owed
    FROM "Order"
    WHERE "customerPhone" IS NOT NULL
      AND "customerPhone" <> ''
      AND status <> 'CANCELLED'
    GROUP BY "customerPhone"
    ORDER BY spend DESC
    LIMIT 200`

  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">{t('customersTitle')}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-300">{t('customersHint')}</p>
      </header>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-100 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-300">
            <tr>
              <th className="px-4 py-3 font-medium">{t('colName')}</th>
              <th className="px-4 py-3 font-medium">{t('colPhone')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('colOrderCount')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('colCustTotal')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('colCustOwed')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-zinc-400">
                  {t('noCustomers')}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.phone}
                className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/60 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
              >
                <td className="px-4 py-3">{r.name ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.phone}</td>
                <td className="px-4 py-3 text-right tabular-nums">{Number(r.cnt)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(Number(r.spend))}</td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    Number(r.owed) > 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-300'
                  }`}
                >
                  {fmt(Number(r.owed))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
