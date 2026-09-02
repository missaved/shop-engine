'use client'
// 老板侧客户台账：会员列表默认折叠（头+数量），点击展开列出全部会员；保留会员(手机/姓名) + 卡 搜索
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getLaundryCustomers } from '@/lib/laundry-actions'
import { formatPrice } from '@/lib/format'

type Row = { phone: string; name: string | null; balance: string; orderCount: number; spend: string; paid: string; cards: { id: string; type: string; name: string | null; remainingCount: number | null; balance: string }[] }

export function LaundryCustomers({ currency }: { currency: string }) {
  const t = useTranslations('laundry')
  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState(true)
  const load = useCallback(async () => {
    try { setRows(await getLaundryCustomers()) } catch { /* ignore */ }
  }, [])
  useEffect(() => { load() }, [load])
  // 会员(手机/姓名) + 卡(卡名) 搜索
  const filtered = rows.filter((r) => {
    if (!q) return true
    const cardMatch = r.cards.some((c) => (c.name ?? '').includes(q) || c.type.includes(q))
    return r.phone.includes(q) || (r.name ?? '').includes(q) || cardMatch
  })

  return (
    <div className="flex flex-col gap-3">
      <button onClick={() => setCollapsed((c) => !c)} className="flex w-full items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{t('customers')}</h2>
        <span className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{filtered.length}</span>
          <span className="text-xs">{collapsed ? '▸' : '▾'}</span>
        </span>
      </button>
      {!collapsed && (
        <>
          <div className="flex items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchCustomer')} className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            <span className="text-sm text-zinc-500">{filtered.length}</span>
          </div>
          {filtered.length === 0 && <p className="py-6 text-center text-sm text-zinc-400">{t('empty')}</p>}
          <div className="flex flex-col gap-2">
            {filtered.map((r) => (
              <div key={r.phone} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{r.name ?? r.phone}</span>
                  <span className="text-sm text-zinc-500">{r.phone}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                  <span>{t('balance')}: {formatPrice(Number(r.balance), currency)}</span>
                  <span>{t('orderCount')}: {r.orderCount}</span>
                  <span>{t('spend')}: {formatPrice(Number(r.spend), currency)}</span>
                </div>
                {r.cards.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                    {r.cards.map((c) => (
                      <span key={c.id}>{c.name ?? (c.type === 'count' ? t('cardCountName') : t('cardCreditName'))}: {c.type === 'count' ? `${c.remainingCount} ${t('times')}` : formatPrice(Number(c.balance), currency)}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
