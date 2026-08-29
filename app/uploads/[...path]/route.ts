// 兜底静态服务（2026-08-29 修复）：Next 生产模式 public 静态服务只认「启动时快照」内的文件，
// 运行期新增的图片（admin 重新生成 / 后台脚本生成）不在快照 → 404「图片出不来」。
// 此 route handler 实时读盘兜底：旧文件仍走 serveStatic（快照内优先），新文件命中这里 → 200。URL 不变、存量零迁移。
import { readFile } from 'fs/promises'
import path from 'path'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
}

const UPLOADS_ROOT = path.join(process.cwd(), 'public', 'uploads')

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path ?? []
  // 安全：拒绝路径穿越（.. / 反斜杠 / 空字节）
  for (const seg of segments) {
    if (seg === '..' || seg.includes('\\') || seg.includes('\0')) {
      return new Response('Bad Request', { status: 400 })
    }
  }
  const filePath = path.join(UPLOADS_ROOT, ...segments)
  // 归一化后必须仍落在 UPLOADS_ROOT 内
  if (!filePath.startsWith(UPLOADS_ROOT + path.sep)) {
    return new Response('Bad Request', { status: 400 })
  }
  try {
    const buf = await readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        // 文件名含时间戳、可被重新生成覆盖，客户端缓存需 revalidate
        'Cache-Control': 'public, max-age=0',
      },
    })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return new Response('Not Found', { status: 404 })
    console.error('兜底静态服务读取失败（%s）:', filePath, e)
    return new Response('Internal Server Error', { status: 500 })
  }
}
