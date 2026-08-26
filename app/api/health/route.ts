// 健康检查：验证服务与数据库均可用（绕过 locale 路由，见 proxy.ts matcher）
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return Response.json({
      status: 'ok',
      db: 'up',
      time: new Date().toISOString(),
    })
  } catch (e) {
    console.error('健康检查失败（数据库不可达）:', e)
    return Response.json({ status: 'error', db: 'down' }, { status: 500 })
  }
}
