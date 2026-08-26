'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { deleteMyData } from '@/lib/shop-actions'

// P2-1 PDPD 一键删除：客户删除本单个人数据（手机号/姓名/备注），确认后匿名化
export function DeleteMyData({
  slug,
  orderNo,
  phone,
}: {
  slug: string
  orderNo: string
  phone: string
}) {
  const t = useTranslations('track')
  const router = useRouter()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (!window.confirm(t('deleteConfirm'))) return
    try {
      await deleteMyData({ slug, orderNo, phone })
      setDone(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  if (done) {
    return <p className="text-sm text-green-700 dark:text-green-300">{t('deleted')}</p>
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onClick}
        className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
      >
        {t('deleteMyData')}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
