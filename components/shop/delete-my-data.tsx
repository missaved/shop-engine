'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { deleteMyData } from '@/lib/shop-actions'
import { shopUrl } from '@/lib/urls'
import type { Vertical } from '@/lib/vertical'
import type { CitySlug } from '@/lib/city'

// P2-1 PDPD 一键删除：客户删除本单个人数据（手机号/姓名/备注），确认后匿名化
export function DeleteMyData({
  vertical,
  slug,
  city,
  orderNo,
  phone,
  guestKey,
}: {
  vertical: Vertical
  slug: string
  city: CitySlug
  orderNo: string
  phone: string
  guestKey?: string
}) {
  const t = useTranslations('track')
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (!window.confirm(t('deleteConfirm'))) return
    try {
      await deleteMyData({ slug, orderNo, phone, guestKey })
      // 删除成功后立即返回主页面（用户反馈：删除后不应停留在还能看到订单详情的查单页）
      router.push(shopUrl({ vertical, slug, city }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onClick}
        className="w-full rounded-md border border-red-300 px-4 py-2.5 text-lg text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
      >
        {t('deleteMyData')}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
