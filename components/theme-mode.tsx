// 主题模式（深/浅/系统）初始化 + 切换工具。
// 深色类 class 驱动（globals.css @custom-variant dark），由这里把「用户偏好」同步成 <html>.dark。
// 偏好存 cookie `spotnear.theme`（light | dark | system），缺省 system（跟随系统，行为与 prefers-color-scheme 一致）。
// 范围：中台可手动切；客户端/老板端默认跟系统（挂载本初始化以保证 dark: 类不失效，无 UI、无行为变化）。
'use client'

import { useCallback, useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

const COOKIE = 'spotnear.theme'

/** 读偏好（cookie），非法/缺省回 system */
export function readThemeMode(): ThemeMode {
  if (typeof document === 'undefined') return 'system'
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`))
  const v = m?.[1]
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

/** resolve：偏好 → 实际是否深色。system 读 matchMedia。 */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 把当前偏好应用到 <html>.dark（写 class 不写 cookie，供 UI 即时反馈用） */
export function applyThemeClass(mode: ThemeMode) {
  const dark = resolveDark(mode)
  document.documentElement.classList.toggle('dark', dark)
}

/** 持久化偏好 + 应用。写 cookie（全站生效）。 */
export function setThemeMode(mode: ThemeMode) {
  document.cookie = `${COOKIE}=${mode}; max-age=31536000; path=/; SameSite=Lax`
  applyThemeClass(mode)
  // 通知同页其它组件（如切换器）刷新当前显示
  window.dispatchEvent(new CustomEvent('themechange', { detail: { mode } }))
}

/** 主题切换 hook：读偏好、跟系统变化、暴露当前 mode + setMode。 */
export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>('system')

  useEffect(() => {
    const apply = () => setMode(readThemeMode())
    apply()
    // 监听同页 setThemeMode 事件
    window.addEventListener('themechange', (e) => setMode((e as CustomEvent).detail.mode))
    return () => window.removeEventListener('themechange', (e) =>
      setMode((e as CustomEvent).detail.mode),
    )
  }, [])

  // 系统偏好变化：仅当当前是 system 时跟随
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (readThemeMode() === 'system') {
        applyThemeClass('system')
        setMode('system')
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const set = useCallback((m: ThemeMode) => setThemeMode(m), [])
  return { mode, setMode: set }
}
