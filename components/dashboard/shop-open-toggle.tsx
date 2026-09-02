'use client'
// 营业开关（打烊/营业切换），复用 food 的 toggleShopOpen；laundry/moto 设置顶部通用
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { toggleShopOpen } from '@/lib/actions'

export function ShopOpenToggle({ open: initialOpen }: { open: boolean }) {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const [open, setOpen] = useState(initialOpen)
  const [pending, setPending] = useState(false)

  const toggle = async () => {
    setPending(true)
    try {
      await toggleShopOpen()
      setOpen((v) => !v)
      router.refresh()
    } catch {
      /* 忽略 */
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span className={`rounded-full px-3 py-1 text-sm font-medium ${open ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
        {open ? t('open') : t('closed')}
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`rounded-md px-3 py-2 text-sm transition-colors disabled:opacity-60 ${open ? 'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950' : 'bg-green-600 text-white hover:bg-green-700'}`}
      >
        {open ? t('closed') : t('open')}
      </button>
    </section>
  )
}
