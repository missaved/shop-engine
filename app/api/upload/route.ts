// 老板端菜品图片上传：登录校验 + 类型/大小校验，存 public/uploads（Next 静态目录，/uploads/xxx 直接访问）
import { auth } from '@/auth'
import { randomUUID } from 'crypto'
import { save } from '@/lib/storage'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB（菜品图，够用且防占满磁盘）
// 审计 13 轮 Y：MIME（file.type）由客户端申报可伪造 → 服务端按字节头（magic bytes）验货并定格式/扩展名。
// file.type 白名单仅作快拒，不再决定落盘扩展名；SVG 本就不在白名单（无 SVG-XSS 面）。
const MIME_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
// 各格式文件头固定字节（身份证，伪造不了）：PNG 8 字节签名 / JPEG FFD8FF / WebP RIFF....WEBP / GIF 'GIF8'
const MAGIC: Array<{ ext: string; test: (b: Buffer) => boolean }> = [
  {
    ext: 'png',
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  { ext: 'jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', test: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { ext: 'gif', test: (b) => b.length >= 4 && b.toString('ascii', 0, 4) === 'GIF8' },
]

export async function POST(request: Request) {
  // 仅老板可上传（防匿名滥用占磁盘）；未登录返回 401
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: '未登录' }, { status: 401 })
  }

  try {
    const form = await request.formData()
    const file = form.get('file')
    // FormDataEntryValue = File | string，排除 string 即收窄为 File
    if (!file || typeof file === 'string') {
      return Response.json({ error: '缺少文件' }, { status: 400 })
    }

    if (!MIME_ALLOWED.has(file.type)) {
      return Response.json({ error: '仅支持 jpg/png/webp/gif' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > MAX_SIZE) {
      return Response.json({ error: '图片过大（≤5MB）' }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    // 字节头验货：内容必须匹配白名单图片格式，扩展名取魔数判定（不信客户端申报的 file.type）
    const sniffed = MAGIC.find((m) => m.test(buf))
    if (!sniffed) {
      return Response.json({ error: '仅支持 jpg/png/webp/gif' }, { status: 400 })
    }
    const name = `${randomUUID()}.${sniffed.ext}`
    // 走 storage 抽象：local 写 public/uploads，s3 写对象存储（保持 /uploads/xxx 相对 URL 语义）
    const saved = await save(buf, `uploads/${name}`)

    return Response.json({ url: saved.url })
  } catch (e) {
    console.error('上传图片失败:', e)
    return Response.json({ error: '上传失败' }, { status: 500 })
  }
}
