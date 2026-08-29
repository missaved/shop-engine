'use client'
// 网站访问统计埋点（2026-08-29）：页面加载 + 路径变化时上报 /api/visit。
// sendBeacon 不阻塞页面、退出前也能送达；只记客户端真实页面访问（不记静态资源/API）。
// 高频刷新本期不去重（可选增强项后置）。
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

export function VisitTracker() {
  const pathname = usePathname()
  const last = useRef('')

  useEffect(() => {
    if (pathname === last.current) return
    last.current = pathname
    try {
      navigator.sendBeacon(
        '/api/visit',
        new Blob([JSON.stringify({ path: pathname, referer: document.referrer })], {
          type: 'application/json',
        }),
      )
    } catch {
      // 记录失败不阻塞页面
    }
  }, [pathname])

  return null
}
