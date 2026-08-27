'use client'

// 保存桌面 PWA 提示：Android/桌面监听 beforeinstallprompt 一键安装；iOS 提示分享→添加到主屏幕
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallPWA() {
  const t = useTranslations('common')
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIOS, setIsIOS] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    // iOS 无 beforeinstallprompt，且已安装（standalone）时不提示
    const nav = navigator as Navigator & { standalone?: boolean }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !nav.standalone
    setIsIOS(ios)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
    setHidden(true)
  }

  // 无安装入口（Android/桌面未触发 prompt、非 iOS）→ 不渲染
  if (hidden || (!deferred && !isIOS)) return null

  return (
    <div className="fixed inset-x-4 top-4 z-40 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t('installApp')}</p>
        <p className="truncate text-xs text-zinc-500">
          {deferred ? t('installDesc') : t('installIos')}
        </p>
      </div>
      {deferred && (
        <button
          onClick={install}
          className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600"
        >
          {t('installBtn')}
        </button>
      )}
      <button
        onClick={() => setHidden(true)}
        aria-label={t('dismiss')}
        className="shrink-0 text-lg leading-none text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200"
      >
        ×
      </button>
    </div>
  )
}
