'use client'

import { signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'

// 平台运营后台：退出登录（点击先 confirm 防误触，确认后客户端登出并跳转 /login）
export function LogoutButton() {
  const t = useTranslations('admin')

  async function onLogout() {
    if (!window.confirm(t('logoutConfirm'))) return
    await signOut({ redirectTo: '/login' })
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      className="rounded-md border border-zinc-300 px-2.5 py-1 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-red-400"
    >
      {t('logout')}
    </button>
  )
}
