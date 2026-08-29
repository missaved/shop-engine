// 访问统计埋点接收（2026-08-29）：客户端页面加载时 sendBeacon POST 到这里。
// 读 Cloudflare 隧道附加头：CF-Connecting-IP（访客 IP）/ CF-IPCountry（来源国家），免 GeoIP 库；
// 本地直连无 CF 头时兜底 x-forwarded-for / null。写入失败不阻塞页面。
import { prisma } from '@/lib/prisma'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { path?: string; referer?: string } = {}
  try {
    body = await req.json()
  } catch {
    // 空 body 也能记（只记 IP/UA），不抛错
  }
  const path = (body.path ?? req.nextUrl.pathname).slice(0, 500)
  const referer = (body.referer ?? '').slice(0, 500) || null

  try {
    await prisma.visitLog.create({
      data: {
        path,
        referer,
        ip:
          (req.headers.get('cf-connecting-ip') ??
            req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
            null)?.slice(0, 64) ?? null,
        country: req.headers.get('cf-ipcountry')?.slice(0, 2) ?? null,
        ua: req.headers.get('user-agent')?.slice(0, 300) ?? null,
      },
    })
    return Response.json({ ok: true })
  } catch (e) {
    console.error('访问统计写入失败（不阻塞页面）:', e)
    return Response.json({ ok: false }, { status: 500 })
  }
}
