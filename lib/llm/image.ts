// 文生图（第 19 批 A3）：minimax image-01 出图 → 存 public/uploads/presets/{country}/{subcategory}/{slug}.jpg → 返回公开 URL
// 约束（用户 2026-08-28）：出图只用 minimax；限流（1004/1042）退避重试，超额（1008/持续限流）报 QUOTA 等复位，不造假占位
// minimax 有限流（8.1）：并发 1 + 请求间隔；失败按错误类型处置（下一步由调用方决定）
import { promises as fs } from 'node:fs'
import path from 'node:path'

// 输出根目录：与 /api/upload 同目录（9.6 单实例可写；生产 CF 隧道下 imageUrl 已是 URL 抽象，预留对象存储）
const OUT_DIR = path.join(process.cwd(), 'public', 'uploads', 'presets')

// 占位图兜底（10.2）：非限流/余额类偶发失败时用；QUOTA 类失败不走占位（等复位重跑）
export const PLACEHOLDER_URL = '/uploads/presets/placeholder.jpg'

// minimax 限流节奏：并发 1 + 间隔，串行执行
const GAP_MS = 1500 // 10.3：请求间隔 1-2s
let lastCallAt = 0
async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastCallAt + GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCallAt = Date.now()
  return fn()
}

export interface GeneratedImage {
  ok: true
  url: string // 公开 URL（/uploads/presets/{country}/{subcat}/{slug}.jpg）
  filePath: string
}
export type ImageResult = GeneratedImage | { ok: false; error: string }

// 归档语义：文件名含国家/子分类/菜名 slug，磁盘可读（用户：不要做出来不知道哪个国家/名字/菜系）
export interface GenerateImageMeta {
  country?: string
  subcategory?: string
  slug?: string
}

const imageUrl = (key: string) => (key.startsWith('sk-cp-') ? 'https://api.minimaxi.com/v1/image_generation' : 'https://api.minimax.io/v1/image_generation')

// 单次请求
async function callImage(key: string, prompt: string) {
  const url = imageUrl(key)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'image-01', prompt, aspect_ratio: '1:1', n: 1, response_format: 'base64' }),
    signal: AbortSignal.timeout(120_000),
  })
  return (await res.json().catch(() => ({}))) as {
    data?: { image_base64?: string[] }
    base_resp?: { status_code?: number; status_msg?: string }
  }
}

/** minimax 文生图一张（写实食物摄影 prompt），按 country/subcat/slug 归档，返回公开 URL */
export async function generateImage(prompt: string, meta?: GenerateImageMeta): Promise<ImageResult> {
  const key = process.env.MINIMAX_API_KEY
  if (!key) return { ok: false, error: 'minimax: MINIMAX_API_KEY 未配置' }
  try {
    const country = (meta?.country ?? 'vn').toLowerCase()
    const sub = (meta?.subcategory ?? 'misc').toLowerCase()
    const slug = meta?.slug ?? 'preset'

    const call = () => throttled(() => callImage(key, prompt))
    let j = await call()

    // 限流码（1004/1042）退避重试，最多 3 次（用户 2026-08-28：超额就等复位，可慢不可错）
    const RATE_CODES = [1004, 1042]
    if (!j.data?.image_base64?.[0] && j.base_resp && RATE_CODES.includes(j.base_resp.status_code ?? -1)) {
      for (const wait of [10_000, 30_000, 60_000]) {
        console.log(`minimax 限流 ${j.base_resp?.status_code}，${wait / 1000}s 后重试...`)
        await new Promise((r) => setTimeout(r, wait))
        j = await call()
        if (j.data?.image_base64?.[0]) break
      }
    }

    const b64 = j.data?.image_base64?.[0]
    if (!b64) {
      const code = j.base_resp?.status_code
      // 超额/持续限流：QUOTA 前缀标记 → 调用方停止批次等待复位，不写占位图（用户约束）
      if (code === 1008) return { ok: false, error: `QUOTA: minimax 余额不足（1008 ${j.base_resp?.status_msg ?? ''}），等待复位后重跑` }
      if (code === 1004 || code === 1042) return { ok: false, error: `QUOTA: minimax 限流持续（${code}），等待复位后重跑` }
      return { ok: false, error: `minimax 无图返回: ${JSON.stringify(j).slice(0, 200)}` }
    }

    await fs.mkdir(path.join(OUT_DIR, country, sub), { recursive: true })
    const filename = `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const filePath = path.join(OUT_DIR, country, sub, filename)
    await fs.writeFile(filePath, Buffer.from(b64, 'base64'))
    return { ok: true, url: `/uploads/presets/${country}/${sub}/${filename}`, filePath }
  } catch (e) {
    return { ok: false, error: `minimax 出图异常: ${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}` }
  }
}
