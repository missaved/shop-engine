'use client'
// 营业收入多档卡片（今天/3天/7天/30天 营业额+订单数），复用 food RevenueCard（照 food 设置）
import { useCallback, useEffect, useState } from 'react'
import { getMotoRevenue } from '@/lib/moto-actions'
import { RevenueCard } from '@/components/dashboard/revenue-card'

type R = { todayRevenue: string; count1: number; revenue3d: string; count3: number; revenue7d: string; count7: number; revenue30d: string; count30: number }

export function MotoRevenueCard({ currency }: { currency: string }) {
  const [r, setR] = useState<R | null>(null)
  const load = useCallback(async () => {
    try { setR(await getMotoRevenue()) } catch { /* ignore */ }
  }, [])
  useEffect(() => { load() }, [load])
  if (!r) return null
  return (
    <RevenueCard
      day1={Number(r.todayRevenue)} day3={Number(r.revenue3d)} day7={Number(r.revenue7d)} day30={Number(r.revenue30d)}
      count1={r.count1} count3={r.count3} count7={r.count7} count30={r.count30}
      currency={currency}
    />
  )
}
