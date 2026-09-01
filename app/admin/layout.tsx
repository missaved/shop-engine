import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import '../globals.css'

// 说明：title 实际由 admin/[locale]/layout.tsx 的 generateMetadata 按 locale 覆盖（Site 接线在那边做），
// 此处静态 metadata 仅作兜底
export const metadata = {
  title: 'shop-engine · 平台运营后台',
  description: 'SaaS 平台运营管理端（管理员电脑用）',
}

// 深/浅/系统主题：SSR 首帧即按 cookie 偏好决定 <html> 是否带 .dark（避免闪白/闪黑）。
// 前端切换由 components/theme-mode 的初始化脚本 + 切换器负责（写 cookie + 即时 toggle .dark）。
async function initialDark(): Promise<boolean> {
  try {
    const m = (await cookies()).get('spotnear.theme')?.value
    const mode = m === 'light' || m === 'dark' ? m : 'system'
    if (mode === 'dark') return true
    if (mode === 'light') return false
    // v5 无 matchMedia（server），system 默认浅色；dark 模式由客户端脚本按系统偏好纠正
    return false
  } catch {
    return false
  }
}

// admin 顶层布局：SaaS 管理后台独立路由树（app/admin/），与客户端 /[locale] 树并行。
// 提供 html/body + 全局样式；纯桌面后台，灰白底（深色切换由 .dark class 驱动）；locale 由下一层处理
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const dark = await initialDark()
  return (
    <html lang="zh" className={`h-full antialiased${dark ? ' dark' : ''}`}>
      <head>
        {/* 深/浅/系统主题：首帧前按偏好同步 <html>.dark（防闪烁，覆盖 SSR 后系统偏好变化）。范围仅中台 html 树。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var m=(document.cookie.match(/(?:^|; )spotnear\\.theme=([^;]*)/)||[])[1]||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();",
          }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        {children}
      </body>
    </html>
  )
}
