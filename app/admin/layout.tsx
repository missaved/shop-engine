import type { ReactNode } from 'react'
import '../globals.css'

// 说明：title 实际由 admin/[locale]/layout.tsx 的 generateMetadata 按 locale 覆盖（Site 接线在那边做），
// 此处静态 metadata 仅作兜底
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
