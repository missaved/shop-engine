// 一次性脚本：用 MiniMax 文生图生成「单一垂直场景图」到 public/vertical/<slug>.jpg
// 用法：node scripts/generate-vertical-image.mjs <slug> "<prompt>" [ratio]
//   例：node scripts/generate-vertical-image.mjs laundry "Modern self-service laundry room with a row of washing machines and dryers, folded clothes, clean bright interior, professional photography, no text" 4:3
// 依赖 .env：MINIMAX_API_KEY（必填）；sk-cp- 走 api.minimaxi.com，否则 api.minimax.io
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

// CLI 参数
const [slug, prompt, ratio = '4:3'] = process.argv.slice(2)
if (!slug || !prompt) {
  console.error('用法：node scripts/generate-vertical-image.mjs <slug> "<prompt>" [ratio]')
  console.error('示例：node scripts/generate-vertical-image.mjs laundry "Modern self-service laundry room, row of washing machines and dryers, folded clothes, clean bright interior, no text" 4:3')
  process.exit(1)
}

const env = loadEnv()
const API_KEY = env.MINIMAX_API_KEY
const IMAGE_BASE_URL = API_KEY?.startsWith('sk-cp-')
  ? 'https://api.minimaxi.com/v1/image_generation'
  : 'https://api.minimax.io/v1/image_generation'

if (!API_KEY) {
  console.error('❌ 缺少 MINIMAX_API_KEY（.env）')
  process.exit(1)
}

async function generate(p, ratio) {
  const body = { model: 'image-01', prompt: p, aspect_ratio: ratio, n: 1, response_format: 'base64' }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` }
  const res = await fetch(IMAGE_BASE_URL, { method: 'POST', headers, body: JSON.stringify(body) })
  const json = await res.json()
  const b64 = json.data?.image_base64?.[0]
  if (!b64) throw new Error(`响应缺少 data.image_base64: ${JSON.stringify(json).slice(0, 200)}`)
  return Buffer.from(b64, 'base64')
}

async function main() {
  const outDir = resolve(__dirname, '../public/vertical')
  mkdirSync(outDir, { recursive: true })
  const buf = await generate(prompt, ratio)
  const file = resolve(outDir, `${slug}.jpg`)
  writeFileSync(file, buf)
  console.log(`✅ public/vertical/${slug}.jpg（${buf.length} bytes，${ratio}）`)
}

main().catch((e) => {
  console.error('生成失败:', e)
  process.exit(1)
})
