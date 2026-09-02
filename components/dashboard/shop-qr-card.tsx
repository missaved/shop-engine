'use client'
// 门店二维码卡：生成指向顾客入口的二维码（无桌号，供 la laundry/moto 复用），可下载打印
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { generateShopQr } from '@/lib/qr-actions'
import { absoluteUrl, shopSubUrl } from '@/lib/urls'
import type { Vertical } from '@/lib/vertical'

export function ShopQrCard({
  vertical,
  slug,
  shopName,
  city,
}: {
  vertical: Vertical
  slug: string
  shopName: string
  city?: string
}) {
  const t = useTranslations('dashboard')
  const [dataUrl, setDataUrl] = useState('')
  const [busy, setBusy] = useState(false)

  // 指向本店顾客入口（laundry=storefront / moto=lookup / food=menu 由调用方传 entry）
  const entry = vertical === 'LAUNDRY' ? 'storefront' : 'lookup'
  const load = useCallback(async () => {
    if (!slug) return
    const url = absoluteUrl(shopSubUrl({ vertical, slug, city }, entry))
    setBusy(true)
    try { setDataUrl(await generateShopQr(url)) } catch { setDataUrl('') } finally { setBusy(false) }
  }, [slug, vertical, city, entry])
  useEffect(() => { load() }, [load])

  const download = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${shopName}-qr.png`
    a.click()
  }

  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="self-start text-base font-semibold text-zinc-700 dark:text-zinc-200">{t('shopQr')}</h2>
      {dataUrl ? (
        <img src={dataUrl} alt={shopName} className="h-44 w-44 rounded-lg border border-zinc-200 dark:border-zinc-700" />
      ) : (
        <div className="flex h-44 w-44 items-center justify-center text-sm text-zinc-400">{busy ? t('qrGenerating') : t('qrFailed')}</div>
      )}
      <div className="flex w-full flex-col gap-1 text-center">
        <span className="text-sm font-semibold">{shopName}</span>
        <span className="text-xs text-zinc-400">{t('shopQrHint')}</span>
      </div>
      <button
        type="button"
        onClick={download}
        disabled={!dataUrl}
        className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {t('downloadQr')}
      </button>
    </section>
  )
}
