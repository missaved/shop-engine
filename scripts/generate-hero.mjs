// 一次性脚本：用 MiniMax 文生图生成首页开屏图 + 装饰图到 public/hero/
// 用法：在 app/ 目录下运行 `node scripts/generate-hero.mjs`
// 依赖 .env：MINIMAX_API_KEY（必填）；国内版 key（sk-cp-）自动走 api.minimaxi.com
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const p = resolve(__dirname, '../.env')
  const out = {}
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
  return out
}

const env = loadEnv()
const API_KEY = env.MINIMAX_API_KEY
// 图片生成端点与 TTS 同域不同路径：国内 api.minimaxi.com / 国际 api.minimax.io
// 注意：MINIMAX_BASE_URL 是 TTS 专用（…/t2a_v2），此处不拼接，按 key 前缀独立推断域名
const IMAGE_BASE_URL = API_KEY?.startsWith('sk-cp-')
  ? 'https://api.minimaxi.com/v1/image_generation'
  : 'https://api.minimax.io/v1/image_generation'

if (!API_KEY) {
  console.error('❌ 缺少 MINIMAX_API_KEY')
  process.exit(1)
}

// 生成图清单：越南河粉店风格，无文字（避免 AI 生成乱码文字），暖色专业
const JOBS = [
  { file: 'hero.jpg', prompt: 'Warm Vietnamese pho restaurant interior, a steaming bowl of beef pho with fresh herbs (basil, bean sprouts, lime) in sharp focus on a wooden table, soft warm ambient lighting, shallow depth of field, professional food photography, warm tones, clean minimal, appetizing, no text, no words', ratio: '16:9' },
  { file: 'dine-in.jpg', prompt: 'Cozy Vietnamese restaurant dining table set for eat-in service, chopsticks and bowl on wooden table, warm lighting, minimal flat illustration style, warm orange and cream palette, no text', ratio: '1:1' },
  { file: 'takeaway.jpg', prompt: 'Vietnamese pho takeaway paper box with chopsticks, clean minimal flat illustration, warm orange cream palette, appetizing, no text', ratio: '1:1' },
  { file: 'delivery.jpg', prompt: 'Vietnamese food delivery scooter with food bag, clean minimal flat illustration, warm orange cream palette, no text', ratio: '1:1' },
]

async function generate(prompt, ratio) {
  const body = {
    model: 'image-01',
    prompt,
    aspect_ratio: ratio,
    n: 1,
    response_format: 'base64',
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` }
  const res = await fetch(IMAGE_BASE_URL, { method: 'POST', headers, body: JSON.stringify(body) })
  const json = await res.json()
  // 国内版直接返回 { data: { image_base64: [...] } }，无 base_resp 包装
  const b64 = json.data?.image_base64?.[0]
  if (!b64) throw new Error(`响应缺少 data.image_base64: ${JSON.stringify(json).slice(0, 200)}`)
  return Buffer.from(b64, 'base64')
}

async function main() {
  const outDir = resolve(__dirname, '../public/hero')
  mkdirSync(outDir, { recursive: true })
  for (const job of JOBS) {
    const buf = await generate(job.prompt, job.ratio)
    const file = resolve(outDir, job.file)
    writeFileSync(file, buf)
    console.log(`✅ ${job.file}（${buf.length} bytes，${job.ratio}）`)
  }
  console.log('全部生成完毕 → public/hero/')
}

main().catch((e) => {
  console.error('生成失败:', e)
  process.exit(1)
})
