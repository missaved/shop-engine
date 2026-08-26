import type { ReactNode } from 'react'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import '../globals.css'

export const metadata = {
  title: 'shop-engine',
  description: '轻量开单引擎 · 一家店一个租户',
  manifest: '/manifest.json', // P1-2 PWA 安装入口
}

// 根布局按 [locale] 收口：未知 locale 直接 404
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  const messages = await getMessages()

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-orange-50/40 text-zinc-900 dark:bg-black dark:text-zinc-50">
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
        {/* P1-2 PWA：注册 service worker（断网可离线打开菜单页） */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}",
          }}
        />
      </body>
    </html>
  )
}
