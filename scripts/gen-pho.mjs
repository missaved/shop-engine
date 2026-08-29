import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
const __dirname = dirname(fileURLToPath(import.meta.url))
function loadEnv() {
  const p = resolve(__dirname, "../.env")
  const out = {}
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  } catch {}
  return out
}
const env = loadEnv()
const KEY = env.MINIMAX_API_KEY
const IMAGE_URL = KEY?.startsWith("sk-cp-")
  ? "https://api.minimaxi.com/v1/image_generation"
  : "https://api.minimax.io/v1/image_generation"
const prompt = "Studio food photography of a steaming bowl of Vietnamese beef pho noodle soup, clear aromatic beef broth, flat rice noodles, rare sliced beef, fresh herbs (Thai basil, bean sprouts, lime wedge, sliced chili), on a rustic wooden table, warm ambient lighting, shallow depth of field, appetizing, no text, no words, high resolution"
const body = { model: "image-01", prompt, aspect_ratio: "1:1", n: 1, response_format: "base64" }
const res = await fetch(IMAGE_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
  body: JSON.stringify(body),
})
const j = await res.json()
const b64 = j.data?.image_base64?.[0]
if (!b64) { console.error("API response:", JSON.stringify(j).slice(0,400)); process.exit(1) }
mkdirSync(resolve(__dirname, "../public/test"), { recursive: true })
const out = resolve(__dirname, "../public/test/pho.png")
writeFileSync(out, Buffer.from(b64, "base64"))
console.log("✅ 生成成功")
console.log("文件:", out)
console.log("大小:", Buffer.from(b64,"base64").length, "bytes")
console.log("endpoint:", IMAGE_URL)
