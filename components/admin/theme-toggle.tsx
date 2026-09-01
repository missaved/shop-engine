'use client'

// 中台主题切换器（浅 / 深 / 跟随系统 三态）。用 theme-mode 的 useThemeMode。
// 放在 admin-shell 顶栏；同步 cookie（全站预热：仅中台 html 有切换 UI，其它项目默认跟系统）。
import { useTranslations } from 'next-intl'
import { useThemeMode, type ThemeMode } from '@/components/theme-mode'

const OPTIONS: { id: ThemeMode; icon: string; key: string }[] = [
  { id: 'light', icon: '☀️', key: 'themeLight' },
  { id: 'system', icon: '💻', key: 'themeSystem' },
  { id: 'dark', icon: '🌙', key: 'themeDark' },
]

export function ThemeToggle() {
  const t = useTranslations('admin')
  const { mode, setMode } = useThemeMode()

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setMode(o.id)}
          title={t(o.key)}
          aria-pressed={mode === o.id}
          className={`flex h-7 w-7 items-center justify-center rounded-md text-[13px] transition-colors ${
            mode === o.id
              ? 'bg-white shadow-sm dark:bg-zinc-700'
              : 'hover:bg-white/60 dark:hover:bg-zinc-700/60'
          }`}
        >
          <span className="leading-none">{o.icon}</span>
        </button>
      ))}
    </div>
  )
}
