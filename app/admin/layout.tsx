import type { ReactNode } from 'react'
import '../globals.css'

export const metadata = {
  title: 'shop-engine · 平台运营后台',
  description: 'SaaS 平台运营管理端（管理员电脑用）',
}

// admin 顶层布局：SaaS 管理后台独立路由树（app/admin/），与客户端 /[locale] 树并行。
// 提供 html/body + 全局样式；纯桌面后台，灰白底（覆盖客户端橙底）；locale 由下一层处理
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        {children}
      </body>
    </html>
  )
}
