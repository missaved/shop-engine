// 存量图片迁移：public/uploads/** → R2 桶（保持相对路径，DB imageUrl 不动，靠 reduce-read 的 resolveImageUrl 拼接）
// 用法：pnpm tsx scripts/migrate-uploads-to-r2.mts [--dry-run]
// 说明：只上传磁盘上的图片文件，不改数据库；DB 里的相对路径 /uploads/... 在 STORAGE_DRIVER=s3 时经 resolve 指向同一对象。
import 'dotenv/config'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const DRY = process.argv.includes('--dry-run')

const UPLOADS_ROOT = path.join(process.cwd(), 'public', 'uploads')
const endpoint = process.env.S3_ENDPOINT
const bucket = process.env.S3_BUCKET
const region = process.env.S3_REGION ?? 'auto'
const akid = process.env.S3_ACCESS_KEY_ID ?? ''
const secret = process.env.S3_SECRET_ACCESS_KEY ?? ''

if (!endpoint || !bucket || !akid || !secret) {
  console.error('缺 S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY（.env）')
  process.exit(1)
}

const client = new S3Client({
  endpoint,
  region,
  credentials: { accessKeyId: akid, secretAccessKey: secret },
})

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
}

async function walk(dir: string, base = ''): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, rel)))
    else out.push(rel)
  }
  return out
}

async function main() {
  const files = await walk(UPLOADS_ROOT)
  console.log(`待上传 ${files.length} 个文件（from public/uploads）\n`)
  let ok = 0, skip = 0

  for (const rel of files) {
    const key = `uploads/${rel}` // 保持相对路径：uploads/xxx
    const full = path.join(UPLOADS_ROOT, rel)
    const ext = path.extname(rel).toLowerCase()
    if (DRY) { console.log(`[dry-run] 将上传 ${key}`); continue }

    try {
      const buf = await fs.readFile(full)
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: MIME[ext] ?? 'application/octet-stream',
      }))
      ok++
      if (ok % 200 === 0) console.log(`已上传 ${ok}/${files.length}…`)
    } catch (e) {
      skip++
      console.error(`跳过 ${key}: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`)
    }
  }

  console.log(`\n完成：上传 ${ok}，跳过 ${skip}${DRY ? '（--dry-run）' : ''}`)
}

main().catch((e) => { console.error('迁移失败:', e); process.exit(1) })
