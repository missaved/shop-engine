'use client'
// M6b 凭证组件：交接生成的凭证展示（只读）+ 复制链接 + WhatsApp/Zalo 深链分享（MessageChannel）
// 无写接口：纯展示 + 分享，无任何 server action / form
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

export function MotoTicket({
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
  order: {
    displayNo: string
    status: string
    progress: string | null
    plate: string
    brand: string | null
    model: string | null
    symptoms: string[]
    estimatedDue: string | null
    total: string
    paidAmount: string
    createdAt: string
  }
}) {
  const t = useTranslations('ticket')
  const tm = useTranslations('moto')
  const { msg, show } = useToast()

  // 裸路径交给 proxy 按浏览器语言适配（不烘焙 locale）；绝对链接用当前访问域名，扫码/分享指向本店
  const url =
    typeof window !== 'undefined'
      ? absoluteUrl(shopSubUrl({ vertical, slug, city }, 'ticket', { ticketId }))
      : ''
  const shareText = `${shopName} · ${order.plate} · #${order.displayNo}\n${url}`

  // 复制兼容：优先 navigator.clipboard（https 安全上下文），http 降级 execCommand（测试/局域网部署，同 moto-reminder-list）
  const copyFallback = (text: string) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url).catch(() => copyFallback(url))
      } else {
        copyFallback(url)
      }
      show(t('copied'))
    } catch (e) {
      console.error('复制链接失败:', e)
      show(t('copyFailed'))
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-400">{shopName}</p>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </div>
      </header>

      {/* 凭证卡 */}
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-500">
            {t('orderNo')} #{order.displayNo}
          </span>
          <span className="text-xs text-zinc-400">
            {new Date(order.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-2xl font-bold tracking-wider">{order.plate}</p>
            <p className="text-xs text-zinc-500">
              {[order.brand, order.model].filter(Boolean).join(' · ') || t('unnamed')}
            </p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            {order.progress ? tm(order.progress as never) : t('unknown')}
          </span>
        </div>
        {order.symptoms.length > 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {t('symptoms')}: {order.symptoms.join('、')}
          </p>
        )}
        {order.estimatedDue && (
          <p className="text-sm text-zinc-500">{t('estimatedDue')}: {order.estimatedDue}</p>
        )}
        <div className="flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <span className="text-sm text-zinc-500">{t('total')}</span>
          <span className="text-lg font-bold text-amber-600 dark:text-amber-400">
            {formatPrice(Number(order.total), currency)}
          </span>
        </div>
      </div>

      {/* 收款信息（老板设置页配置；无则隐藏） */}
      {(payment?.bank?.accountNo || payment?.wallet?.momoQrUrl || payment?.wallet?.zalopayQrUrl) && (
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-semibold">{t('paymentTitle')}</p>
          {payment?.bank?.accountNo && (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {payment.bank.bankName} · {payment.bank.accountNo}
              {payment.bank.accountName ? ` · ${payment.bank.accountName}` : ''}
            </p>
          )}
          {(payment?.wallet?.momoQrUrl || payment?.wallet?.zalopayQrUrl) && (
            <div className="flex gap-3">
              {payment.wallet?.momoQrUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={payment.wallet.momoQrUrl} alt="MoMo" className="h-24 w-24 rounded-lg border border-zinc-200 object-contain dark:border-zinc-800" />
              )}
              {payment.wallet?.zalopayQrUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={payment.wallet.zalopayQrUrl} alt="ZaloPay" className="h-24 w-24 rounded-lg border border-zinc-200 object-contain dark:border-zinc-800" />
              )}
            </div>
          )}
        </div>
      )}

      {/* 复制链接 + 分享 */}
      <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-semibold">{t('shareTitle')}</p>
        <button
          onClick={copy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t('copyLink')}
        </button>
        <div className="grid grid-cols-2 gap-2">
          {MESSAGE_CHANNELS.map((c) => (
            <a
              key={c.id}
              href={channelShareUrl(c.id, shareText)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-center text-sm font-medium dark:border-zinc-700"
            >
              {t(c.labelKey as never)}
            </a>
          ))}
        </div>
      </div>
      <ToastView msg={msg} />
    </main>
  )
}
