// 老板端菜品图片上传：登录校验 + 类型/大小校验，存 public/uploads（Next 静态目录，/uploads/xxx 直接访问）
import { auth } from '@/auth'
import { randomUUID } from 'crypto'
import { save } from '@/lib/storage'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB（菜品图，够用且防占满磁盘）
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

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

    if (!EXT[file.type]) {
      return Response.json({ error: '仅支持 jpg/png/webp/gif' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > MAX_SIZE) {
      return Response.json({ error: '图片过大（≤5MB）' }, { status: 400 })
    }

    const name = `${randomUUID()}.${EXT[file.type]}`
    // 走 storage 抽象：local 写 public/uploads，s3 写对象存储（保持 /uploads/xxx 相对 URL 语义）
    const buf = Buffer.from(await file.arrayBuffer())
    const saved = await save(buf, `uploads/${name}`)

    return Response.json({ url: saved.url })
  } catch (e) {
    console.error('上传图片失败:', e)
    return Response.json({ error: '上传失败' }, { status: 500 })
  }
}
