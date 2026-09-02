'use client'
// LAUNDRY 交接凭证：公开只读（无写接口）。明细/标签码/金额/进度/收款码/护理类型/取送 + 复制链接 + 分享。
// 安全：随 ticketId=randomUUID 由服务端校验防遍历；此处不展示完整手机号（PII 最小化）。
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { formatPrice } from '@/lib/format'
import { MESSAGE_CHANNELS, channelShareUrl } from '@/lib/message-channel'
import { absoluteUrl, shopSubUrl } from '@/lib/urls'
import type { Vertical } from '@/lib/vertical'
import type { CitySlug } from '@/lib/city'
import { useToast, ToastView } from '../dashboard/use-toast'

type PaymentConfig = {
  bank?: { bankName?: string; accountNo?: string; accountName?: string }
  wallet?: { momoQrUrl?: string; zalopayQrUrl?: string }
}

export type LaundryTicketOrder = {
  displayNo: string
  status: string
  progress: string | null
  tagCode: string | null
  mode: string
  kg: number | null
  itemNames: string[]
  itemDetail: { name: string; count: number; mark?: string }[]
  careType: string | null
  qcNote: string | null
  dispatchType: string | null
  address: string | null
  deliveryFee: number | null
  photos: string[]
  total: string
  paidAmount: string
  createdAt: string
}

const PROGRESS_KEY: Record<string, string> = {
  washing_pending: 'progressWashingPending',
  washing: 'progressWashing',
  qc: 'progressQc',
  ready: 'progressReady',
  collected: 'progressCollected',
}

export function LaundryTicket({
  vertical,
  slug,
  city,
  ticketId,
  shopName,
  currency,
  payment,
  order,
}: {
  vertical: Vertical
  slug: string
  city: CitySlug
  ticketId: string
  shopName: string
  currency: string
  payment: PaymentConfig | null
  order: LaundryTicketOrder
}) {
  const t = useTranslations('ticket')
  const tl = useTranslations('laundry')
  const { msg, show } = useToast()
  const [copied, setCopied] = useState(false)
  const url = absoluteUrl(shopSubUrl({ vertical, slug, city }, 'ticket', { ticketId }))
  const debt = Number(order.total) - Number(order.paidAmount)

  const shareText = `${shopName} · ${order.displayNo}${order.tagCode ? ` ${order.tagCode}` : ''}\n${url}`

  const copy = () => {
    const ok = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(shareText).then(() => true)
      : Promise.resolve(false)
    ok.then(() => {
      setCopied(true)
      show(t('copied'))
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // 模式摘要
  const detail =
    order.mode === 'kg'
      ? tl('kgSummary', { kg: order.kg ?? 0 })
      : order.mode === 'item'
        ? (order.itemNames.length ? order.itemNames.join(' · ') : tl('modeItem'))
        : tl('shoeSummary', { style: order.careType ?? '' })

  // 计件明细（品类+数量+污渍点）
  const hasDetail = order.itemDetail.length > 0
  const dispatchLabel =
    order.dispatchType === 'pickup'
      ? tl('dispatchPickup')
      : order.dispatchType === 'deliver'
        ? tl('dispatchDeliver')
        : order.dispatchType
          ? tl('dispatchInStore')
          : null

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-5 py-6">
      {/* 顶部 */}
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">{shopName}</span>
        <span className="text-sm text-zinc-500">{order.displayNo}</span>
      </div>
      {order.tagCode && (
        <div className="rounded-2xl bg-zinc-900 py-4 text-center text-white">
          <div className="text-4xl font-extrabold tracking-wide">{order.tagCode}</div>
          <div className="mt-1 text-xs text-zinc-400">{tl('tagLabel')}</div>
        </div>
      )}

      {/* 明细 */}
      <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">{tl('orderDetail')}</span>
          <span className="font-semibold">{detail}</span>
        </div>
        {order.progress && (
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-zinc-500">{tl('status')}</span>
            <span className="font-medium">{tl(PROGRESS_KEY[order.progress] ?? 'progressReady')}</span>
          </div>
        )}
        {hasDetail && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {order.itemDetail.map((it, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  {it.name} × {it.count}
                  {it.mark ? <span className="ml-1 text-xs text-zinc-400">（{it.mark}）</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {order.careType && (
          <p className="mt-2 text-sm text-zinc-500">{tl('careTypeLabel')}: {order.careType}</p>
        )}
        {dispatchLabel && (
          <p className="mt-2 text-sm text-zinc-500">
            {dispatchLabel}
            {order.address ? ` · ${order.address}` : ''}
          </p>
        )}
        {order.qcNote && <p className="mt-2 text-sm text-zinc-500">{tl('qcNoteLabel')}: {order.qcNote}</p>}
      </section>

      {/* 照片 */}
      {order.photos.length > 0 && (
        <section className="flex gap-2">
          {order.photos.map((p, i) => (
            <img key={i} src={p} alt="" className="h-20 w-20 rounded-lg object-cover" />
          ))}
        </section>
      )}

      {/* 金额 */}
      <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">{tl('total')}</span>
          <span className="font-bold">{formatPrice(Number(order.total), currency)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm">
          <span className="text-zinc-500">{tl('paidNow')}</span>
          <span className="font-medium">{formatPrice(Number(order.paidAmount), currency)}</span>
        </div>
        {debt > 0 && (
          <div className="mt-1 flex items-center justify-between text-sm text-red-600">
            <span>{tl('debt')}</span>
            <span className="font-semibold">{formatPrice(debt, currency)}</span>
          </div>
        )}
      </section>

      {/* 收款码 */}
      {(payment?.bank?.accountNo || payment?.wallet?.momoQrUrl || payment?.wallet?.zalopayQrUrl) && (
        <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="mb-2 text-sm font-semibold">{t('paymentTitle')}</p>
          {payment?.bank?.accountNo && (
            <p className="text-sm text-zinc-600">
              {payment.bank.bankName} · {payment.bank.accountNo} · {payment.bank.accountName}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {payment?.wallet?.momoQrUrl && (
              <img src={payment.wallet.momoQrUrl} alt="MoMo" className="h-24 w-24 rounded-lg border border-zinc-200 object-contain" />
            )}
            {payment?.wallet?.zalopayQrUrl && (
              <img src={payment.wallet.zalopayQrUrl} alt="ZaloPay" className="h-24 w-24 rounded-lg border border-zinc-200 object-contain" />
            )}
          </div>
        </section>
      )}

      {/* 复制 + 分享 */}
      <section className="flex flex-col gap-2">
        <button onClick={copy} className="rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white">
          {copied ? t('copied') : t('copyLink')}
        </button>
        <p className="text-center text-sm text-zinc-500">{t('shareTitle')}</p>
        <div className="grid grid-cols-2 gap-2">
          {MESSAGE_CHANNELS.map((c) => (
            <a
              key={c.id}
              href={channelShareUrl(c.id, shareText)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-3 text-center text-sm font-semibold text-white"
            >
              {t(c.labelKey)}
            </a>
          ))}
        </div>
      </section>
      <ToastView msg={msg} />
    </main>
  )
}
