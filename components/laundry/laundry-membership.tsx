'use client'
// P3 会员面板：按手机号找/建顾客 → 看余额与卡 → 充值 / 开卡（储值卡/次卡）
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  getLaundryCustomer,
  findOrCreateLaundryCustomer,
  topUpLaundryBalance,
  createLaundryCard,
} from '@/lib/laundry-actions'
import { formatPrice } from '@/lib/format'

type Card = { id: string; type: string; name: string | null; remainingCount: number | null; balance: string }
type Customer = { id: string; phone: string | null; name: string | null; balance: string; cards: Card[] }

export function LaundryMembership({ currency }: { currency: string }) {
  const t = useTranslations('laundry')
  const [phone, setPhone] = useState('')
  const [cust, setCust] = useState<Customer | null>(null)
  const [topup, setTopup] = useState(0)
  const [cardType, setCardType] = useState<'credit' | 'count'>('credit')
  const [cardCount, setCardCount] = useState(5)
  const [cardAmount, setCardAmount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async (p: string) => {
    const c = await getLaundryCustomer(p)
    if (!c) throw new Error('未找到顾客')
    setCust({
      id: c.id, phone: c.phone, name: c.name,
      balance: String(Number(c.balance)),
      cards: (c.cards ?? []).map((x) => ({ id: x.id, type: x.type, name: x.name, remainingCount: x.remainingCount, balance: String(Number(x.balance)) })),
    })
  }

  const findOrCreate = async () => {
    setBusy(true); setErr('')
    try { await findOrCreateLaundryCustomer(phone); await load(phone) }
    catch (e) { setErr(e instanceof Error ? e.message : 'err') } finally { setBusy(false) }
  }

  const doTopup = async () => {
    if (!cust) return
    setBusy(true); setErr('')
    try { await topUpLaundryBalance(cust.id, topup); await load(cust.phone ?? '') } catch (e) { setErr(e instanceof Error ? e.message : 'err') } finally { setBusy(false) }
  }

  const doCard = async () => {
    if (!cust) return
    setBusy(true); setErr('')
    try {
      await createLaundryCard({ customerId: cust.id, type: cardType, name: cardType === 'count' ? `${cardCount} ${t('cardCountName')}` : t('cardCreditName'), count: cardCount, amount: cardAmount })
      await load(cust.phone ?? '')
    } catch (e) { setErr(e instanceof Error ? e.message : 'err') } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('membershipTitle')}</div>
      <div className="flex gap-2">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('customerPhone')} className="flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
        <button onClick={findOrCreate} disabled={busy} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{t('lookup')}</button>
      </div>

      {cust && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">{t('balance')}</span>
            <span className="font-bold">{formatPrice(Number(cust.balance), currency)}</span>
          </div>
          {cust.cards.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              {cust.cards.map((c) => (
                <div key={c.id} className="flex justify-between text-zinc-600">
                  <span>{c.name ?? (c.type === 'count' ? t('cardCountName') : t('cardCreditName'))}</span>
                  <span className="font-medium">{c.type === 'count' ? `${c.remainingCount} ${t('times')}` : formatPrice(Number(c.balance), currency)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
              <span className="text-xs text-zinc-500">{t('topup')}</span>
              <input value={topup} onChange={(e) => setTopup(Number(e.target.value) || 0)} inputMode="decimal" className="w-full bg-transparent text-sm font-semibold outline-none" />
            </div>
            <button onClick={doTopup} disabled={busy} className="rounded-lg bg-amber-500 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{t('topup')}</button>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
            <select value={cardType} onChange={(e) => setCardType(e.target.value as 'credit' | 'count')} className="rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              <option value="credit">{t('cardCreditName')}</option>
              <option value="count">{t('cardCountName')}</option>
            </select>
            {cardType === 'count' ? (
              <input value={cardCount} onChange={(e) => setCardCount(Number(e.target.value) || 0)} inputMode="numeric" className="w-16 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            ) : (
              <input value={cardAmount} onChange={(e) => setCardAmount(Number(e.target.value) || 0)} inputMode="decimal" className="w-24 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            )}
            <button onClick={doCard} disabled={busy} className="ml-auto rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{t('openCard')}</button>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  )
}
