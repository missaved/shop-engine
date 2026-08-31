'use client'
// 拍照 OCR（拍车牌→车牌 / 拍仪表盘→里程）：客户端压缩后调 server action motoOcr（gemini 视觉，key 服务端）
// 降级链（计划 10.4）：识别失败 → 提示手动输入；识别结果可由老板修正
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { motoOcr } from '@/lib/moto-actions'

// 客户端压缩：长边 ≤1280 的 jpeg 0.85（OCR 够用，server action 传输体可控）
async function compressToDataUrl(file: File): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('图片解析失败'))
    im.src = src
  })
  const MAX = 1280
  let w = img.width
  let h = img.height
  if (w > MAX || h > MAX) {
    const scale = MAX / Math.max(w, h)
    w = Math.round(w * scale)
    h = Math.round(h * scale)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.85)
}

export function PlateCamera({
  onResult,
  hint,
}: {
  onResult: (r: { plate?: string; mileage?: number | null }) => void
  hint: string
}) {
  const t = useTranslations('moto')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const handleFile = async (file?: File) => {
    if (!file) return
    setBusy(true)
    setErr('')
    try {
      const dataUrl = await compressToDataUrl(file)
      const r = await motoOcr(dataUrl)
      onResult(r)
    } catch (e) {
      setErr(t('ocrFail'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-600 dark:text-zinc-300 ${busy ? 'opacity-60' : ''}`}
      >
        <span aria-hidden>📷</span>
        <span>{busy ? '…' : hint}</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={busy}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </label>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}
