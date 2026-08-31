// OCR 结构化抽取：拍车牌照 → 车牌；拍仪表盘 → 里程
// 用 gemini 视觉（inline_data，见 gemini.ts 视觉扩展）；降级链：识别失败 → 手输（计划 10.4）
// 只做两类结构化字段，不做车型/行驶证全文识别（红线）
import { gemini } from './llm/gemini'
import { normalizePlate } from './plate'

export type OcrResult = {
  plate?: string
  mileage?: number | null
}

// 从模型返回文本中提取 JSON 对象（容错：模型可能夹带解释文字/代码块）
function parseJsonLoose(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const target = fenced ? fenced[1] : text
  const start = target.indexOf('{')
  const end = target.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(target.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

// 一张照片识别车牌 + 里程（照片里没有的字段省略）
export async function extractVehicleFromPhoto(imageDataUrl: string): Promise<OcrResult> {
  const text = await gemini.chat(
    [
      {
        role: 'system',
        content:
          '你是越南摩托维修店的拍照识别助手。识别照片内容，只做两类：1) 摩托车车牌（越南格式，如 59-X1 234.56，输出去掉空格/连字符/点，如 59X123456）2) 里程表读数（纯数字公里数）。照片里识别不到的字段省略不输出。严格返回 JSON：{"plate":"59X123456","mileage":12345}。不要输出任何解释文字。',
      },
      {
        role: 'user',
        content: '请识别这张照片的车牌和里程。',
        imageDataUrl,
      },
    ],
    { timeoutMs: 60_000 },
  )

  const j = parseJsonLoose(text)
  const plateRaw = j?.plate ? String(j.plate) : ''
  const plate = plateRaw ? normalizePlate(plateRaw) : undefined
  const mileage =
    j?.mileage != null && String(j.mileage) !== ''
      ? Math.max(0, Math.round(Number(j.mileage)))
      : undefined

  if (!plate && mileage == null) throw new Error('未能识别车牌或里程')
  return { plate, mileage }
}
