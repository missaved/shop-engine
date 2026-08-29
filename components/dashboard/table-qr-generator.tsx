'use client'

// 桌号引导图 / 门头二维码：老板输入桌号（可选），预览含三语"扫码点单"的引导图，下载二维码打印
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { generateShopQr } from '@/lib/qr-actions'

// 引导图三语固定文案（打印物，不跟随界面语言），分行渲染避免长文案溢出
const TRILINGUAL_LINES = ['扫码点单', 'Quét mã gọi món', 'Scan to order']

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

  // 店铺菜单页 URL 用当前访问域名动态构造（无论部署在哪，扫码都指向本店）；
  // 桌号非空时拼 ?table= 参数 → 扫码后菜单页预填桌号并锁定（用户反馈：桌号要真正进二维码，不能只是台卡上印大字）
  useEffect(() => {
    if (!slug) return
    const no = tableNo.trim()
    const url = no
      ? `${window.location.origin}/s/${slug}?table=${encodeURIComponent(no)}`
      : `${window.location.origin}/s/${slug}`
    // 400ms 防抖：避免每敲一个字符就重生成二维码闪「…」
    const timer = setTimeout(() => {
      setBusy(true)
      generateShopQr(url)
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(''))
        .finally(() => setBusy(false))
    }, 400)
    return () => clearTimeout(timer)
  }, [slug, tableNo])

  // canvas 合成台卡 PNG：白底 + 细边框 + 桌号 + 二维码 + 店名 + 三语，导出一张可打印整图
  function composeCard(dataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const no = tableNo.trim()
        const hasNo = no.length > 0
        const W = 640
        const H = hasNo ? 800 : 640
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('canvas 不可用'))

        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, W, H)
        ctx.strokeStyle = '#e4e4e7'
        ctx.lineWidth = 2
        ctx.strokeRect(16, 16, W - 32, H - 32)

        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        let y = 48

        if (hasNo) {
          ctx.fillStyle = '#18181b'
          ctx.font = 'bold 96px -apple-system, sans-serif'
          ctx.fillText(no, W / 2, y, W - 80)
          y += 128
        }

        const qrSize = 340
        ctx.drawImage(img, (W - qrSize) / 2, y, qrSize, qrSize)
        y += qrSize + 36

        ctx.fillStyle = '#18181b'
        ctx.font = '600 32px -apple-system, sans-serif'
        ctx.fillText(shopName, W / 2, y, W - 80)
        y += 50

        ctx.fillStyle = '#71717a'
        ctx.font = '20px -apple-system, sans-serif'
        for (const line of TRILINGUAL_LINES) {
          ctx.fillText(line, W / 2, y)
          y += 30
        }

        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('二维码图片加载失败'))
      img.src = dataUrl
    })
  }

  async function downloadQr() {
    if (!qrDataUrl) return
    try {
      const png = await composeCard(qrDataUrl)
      const a = document.createElement('a')
      a.href = png
      a.download = `table-${tableNo.trim() || slug}.png`
      a.click()
    } catch (e) {
      console.error('台卡生成失败:', e)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        value={tableNo}
        onChange={(e) => setTableNo(e.target.value)}
        placeholder={t('tableNoPh')}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      />

      {/* 引导图预览：桌号台卡（超大桌号 + 居中二维码 + 店名 + 三语宣传） */}
      <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {tableNo.trim() && (
          <span className="text-6xl font-bold leading-none tracking-tight text-zinc-900 dark:text-zinc-100">
            {tableNo.trim()}
          </span>
        )}
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt="店铺二维码" className="h-52 w-52" />
        ) : (
          <div className="flex h-52 w-52 items-center justify-center text-xs text-zinc-400">
            {busy ? '…' : t('toastError')}
          </div>
        )}
        <span className="text-base font-medium">{shopName}</span>
        <span className="flex flex-col gap-0.5 text-[10px] leading-none text-zinc-400">
          {TRILINGUAL_LINES.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      </div>

      <button
        onClick={downloadQr}
        disabled={!qrDataUrl}
        className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
      >
        {t('downloadQr')}
      </button>
    </div>
  )
}
