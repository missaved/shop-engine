'use client'
// 网站访问统计埋点（2026-08-29）：页面加载 + 路径变化时上报 /api/visit。
// sendBeacon 不阻塞页面、退出前也能送达；只记客户端真实页面访问（不记静态资源/API）。
// P3-AD（2026-09-01）：sessionStorage 会话级去重——同一次会话内同一 path 只上报一次（刷新/反复进出不再发），
// 降 serverless 调用量与 PV 虚高（统计口径 = 每会话每 path 一次）。sessionStorage 不可用时退化为每次上报。
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const reportKey = (path: string) => `visit_report_${path}`

export function VisitTracker() {
  const pathname = usePathname()

  useEffect(() => {
    try {
      if (sessionStorage.getItem(reportKey(pathname))) return
      sessionStorage.setItem(reportKey(pathname), '1')
    } catch {
      // sessionStorage 不可用（隐私模式等）：跳过去重，退化为每次上报
    }
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
