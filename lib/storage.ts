// 存储抽象（Vercel 前置改造）：业务只调 save()/resolveImageUrl()，底层由 STORAGE_DRIVER 决定。
// LocalDriver（默认）：写 public/<key>，url = /<key> —— 与现状逐字节一致，本地 dev/Docker/单 VPS 零感知。
// S3Driver（STORAGE_DRIVER=s3）：写对象存储（Cloudflare R2 / MinIO / AWS S3，S3 兼容通吃）。
// 零破坏原则：不设任何新环境变量 = 完全走 LocalDriver = 跟改造前一模一样。
import { promises as fs } from 'node:fs'
import path from 'node:path'

const STORAGE_DRIVER = process.env.STORAGE_DRIVER ?? 'local'
const S3_PUBLIC_BASE_URL = process.env.STORAGE_PUBLIC_BASE_URL ?? ''

// 启动日志：一眼看清当前存储驱动，避免"以为切了其实没切"（A+B 可操作性改进）
console.log(
  `[storage] driver = ${STORAGE_DRIVER}` +
    (STORAGE_DRIVER === 's3' ? `, base = ${S3_PUBLIC_BASE_URL || '(未设 STORAGE_PUBLIC_BASE_URL)'}` : ''),
)

// LocalDriver 写盘根目录：public/（与 /api/upload 现状一致）
const LOCAL_ROOT = path.join(process.cwd(), 'public')

export interface SaveResult {
  /** 对外公开访问的 URL（local 为相对路径 /<key>；s3 为 ${STORAGE_PUBLIC_BASE_URL}/<key>） */
  url: string
  /** 本地磁盘绝对路径（local 模式有值）；s3 模式无磁盘文件，返回空串 */
  filePath: string
}

/** 保存图片，返回对外可访问 URL。key 无前导斜杠，例：uploads/presets/vn/mains/xx.jpg */
export async function save(buffer: Buffer, key: string): Promise<SaveResult> {
  if (STORAGE_DRIVER === 's3') return saveS3(buffer, key)

  // LocalDriver（默认）：写 public/<key>，返回 /<key>
  const filePath = path.join(LOCAL_ROOT, key)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, buffer)
  return { url: `/${key}`, filePath }
}

/** 把 DB 里存的相对路径（/uploads/...）解析为可访问 URL。local 模式原样返回（no-op）。 */
export function resolveImageUrl(url: string): string {
  if (!url) return url
  if (STORAGE_DRIVER !== 's3') return url
  // s3 模式：相对路径（/uploads/...）拼上公网 base；已是完整 URL 的（http/https）原样返回
  if (/^https?:\/\//i.test(url)) return url
  const suffix = url.startsWith('/') ? url : `/${url}`
  return `${S3_PUBLIC_BASE_URL.replace(/\/$/, '')}${suffix}`
}

// ---- S3Driver（仅 STORAGE_DRIVER=s3 时动态 import，避免本地/CI 无必要加载 @aws-sdk）----
async function saveS3(buffer: Buffer, key: string): Promise<SaveResult> {
  // 延迟加载：只在 s3 模式下才 import，配置缺失时才抛错
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const endpoint = process.env.S3_ENDPOINT
  const bucket = process.env.S3_BUCKET
  const region = process.env.S3_REGION ?? 'auto'
  const akid = process.env.S3_ACCESS_KEY_ID ?? ''
  const secret = process.env.S3_SECRET_ACCESS_KEY ?? ''
  if (!endpoint || !bucket || !akid || !secret) {
    throw new Error('storage: STORAGE_DRIVER=s3 但缺 S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY')
  }

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: akid, secretAccessKey: secret },
    // R2/MinIO 通常需关闭 SSL 校验或简化签名；AWS 默认。先按通用配置，遇报错再调。
  })
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: detectMime(key),
    }),
  )
  // S3 key 不带前导斜杠；公网 URL 由 resolveImageUrl 拼接
  return { url: `/${key}`, filePath: '' }
}

function detectMime(key: string): string {
  const ext = path.extname(key).toLowerCase()
  const mime: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
  }
  return mime[ext] ?? 'application/octet-stream'
}
