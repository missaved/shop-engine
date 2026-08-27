// 一次性脚本：用 MiniMax T2A 生成老板端语音提示 mp3 到 public/sounds/
// 用法：在 app/ 目录下运行 `node scripts/generate-voices.mjs`
// 依赖 .env：MINIMAX_API_KEY（必填）、MINIMAX_GROUP_ID（旧版账号选填）、
//          MINIMAX_BASE_URL（选填，默认 https://api.minimax.io/v1/t2a_v2）、
//          MINIMAX_VOICE_ID（选填，默认 male-qn-qingse）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 简单解析 app/.env（KEY=VALUE），不引入 dotenv 依赖
function loadEnv() {
  const p = resolve(__dirname, '../.env')
  const out = {}
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // .env 不存在则返回空对象，由下方 API_KEY 校验兜底
  }
  return out
}

const env = loadEnv()
const API_KEY = env.MINIMAX_API_KEY
const GROUP_ID = env.MINIMAX_GROUP_ID
// 国内版 key（sk-cp- 开头）须用 api.minimaxi.com，否则报 2049 invalid api key；国际版用 api.minimax.io
const BASE_URL =
  env.MINIMAX_BASE_URL ||
  (API_KEY?.startsWith('sk-cp-') ? 'https://api.minimaxi.com/v1/t2a_v2' : 'https://api.minimax.io/v1/t2a_v2')
const VOICE_ID = env.MINIMAX_VOICE_ID || 'male-qn-qingse'

if (!API_KEY) {
  console.error('❌ 缺少 MINIMAX_API_KEY，请在 app/.env 配置后再运行')
  process.exit(1)
}

// 提示文案（自然口语）：locale -> { type -> text }
const TEXTS = {
  zh: { 'new-order': '您有新的订单', 'call-waiter': '顾客呼叫服务员' },
  vi: { 'new-order': 'Có đơn hàng mới', 'call-waiter': 'Khách gọi nhân viên phục vụ' },
  en: { 'new-order': 'You have a new order', 'call-waiter': 'A customer is calling' },
}

async function synthesize(text) {
  const body = {
    model: 'speech-2.6-turbo',
    text,
    stream: false,
    language_boost: 'auto', // 自动识别文本语言（中/越/英）
    output_format: 'hex',
    voice_setting: { voice_id: VOICE_ID, speed: 1, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` }
  if (GROUP_ID) headers['GroupId'] = GROUP_ID
  const res = await fetch(BASE_URL, { method: 'POST', headers, body: JSON.stringify(body) })
  const json = await res.json()
  if (json.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax 返回错误: ${JSON.stringify(json.base_resp)}`)
  }
  const hex = json.data?.audio
  if (!hex) throw new Error('响应缺少 data.audio')
  return Buffer.from(hex, 'hex')
}

async function main() {
  const outDir = resolve(__dirname, '../public/sounds')
  mkdirSync(outDir, { recursive: true })
  for (const [locale, types] of Object.entries(TEXTS)) {
    for (const [type, text] of Object.entries(types)) {
      const file = resolve(outDir, `${type}.${locale}.mp3`)
      const buf = await synthesize(text)
      writeFileSync(file, buf)
      console.log(`✅ ${type}.${locale}.mp3（${buf.length} bytes）← 「${text}」`)
    }
  }
  console.log('全部生成完毕 → public/sounds/')
}

main().catch((e) => {
  console.error('生成失败:', e)
  process.exit(1)
})
