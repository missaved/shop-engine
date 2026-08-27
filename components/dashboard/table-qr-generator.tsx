'use client'

// 桌号引导图 / 门头二维码：老板输入桌号（可选），预览含三语"扫码点单"的引导图，下载二维码打印
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { generateShopQr } from '@/lib/qr-actions'

// 引导图三语固定文案（打印物，不跟随界面语言）
const TRILINGUAL = '扫码点单 · Quét mã gọi món · Scan to order'

export function TableQrGenerator({
  slug,
  shopName,
}: {
  slug: string
  shopName: string
}) {
  const t = useTranslations('dashboard')
  const [tableNo, setTableNo] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [busy, setBusy] = useState(false)

  // 店铺菜单页 URL 用当前访问域名动态构造（无论部署在哪，扫码都指向本店）
  useEffect(() => {
    if (!slug) return
    const url = `${window.location.origin}/s/${slug}`
    setBusy(true)
    generateShopQr(url)
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
      .finally(() => setBusy(false))
  }, [slug])

  function downloadQr() {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `qr-${slug}${tableNo.trim() ? `-table-${tableNo.trim()}` : ''}.png`
    a.click()
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        value={tableNo}
        onChange={(e) => setTableNo(e.target.value)}
        placeholder={t('tableNoPh')}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      />

      {/* 引导图预览：桌号（可选）+ 三语 + 二维码 + 店名 */}
      <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {tableNo.trim() && (
          <span className="text-4xl font-bold leading-none text-zinc-900 dark:text-zinc-100">
            {tableNo.trim()}
          </span>
        )}
        <span className="text-xs text-zinc-500">{TRILINGUAL}</span>
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt="店铺二维码" className="h-40 w-40" />
        ) : (
          <div className="flex h-40 w-40 items-center justify-center text-xs text-zinc-400">
            {busy ? '…' : t('toastError')}
          </div>
        )}
        <span className="text-sm font-medium">{shopName}</span>
      </div>

      <button
        onClick={downloadQr}
        disabled={!qrDataUrl}
        className="rounded-md bg-amber-500 px-3 py-2 text-sm text-white transition-colors hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-500 dark:text-white"
      >
        {t('downloadQr')}
      </button>
    </div>
  )
}
