// 结构化 JSON 生成：fallback 链（ds→minimax）+ JSON 提取 + zod 校验
// 任一步失败自动切下一个 provider；全部失败返回 { ok: false }（调用方决定兜底/报错）
// 用户 2026-08-28 定：「不要用 gemini，太贵了」→ 默认链仅 ds→minimax（gemini 保留实现待 key/价格策略，不入默认链）
import type { ZodType, z } from 'zod'
import type { LLMProvider, LLMProviderName } from './provider'
import { deepseek } from './deepseek'
import { minimax } from './minimax'

// Partial：gemini 已按用户约束移出默认链，留类型缝待 key/价格策略（不强制所有 provider 就绪）
const PROVIDERS: Partial<Record<LLMProviderName, LLMProvider>> = { ds: deepseek, minimax }
const DEFAULT_ORDER: LLMProviderName[] = ['ds', 'minimax']

export interface GenerateStructuredOptions {
  /** 系统指令：任务说明 + 输出 JSON schema 说明 + 硬性要求 */
  system: string
  /** 用户输入：本次要生成的具体内容（子分类 / N 道 / 语言等） */
  user: string
  /** zod schema：校验并收敛输出类型 */
  schema: ZodType
  /** provider 顺序，默认 ds→minimax→gemini */
  providerOrder?: LLMProviderName[]
  /** 测试/兜底注入：覆盖默认实现（mock 单测用） */
  providerOverrides?: Partial<Record<LLMProviderName, LLMProvider>>
  temperature?: number
  timeoutMs?: number
}

export type GenerateStructuredResult<T> =
  | { ok: true; data: T; modelUsed: LLMProviderName }
  | { ok: false; error: string }

// 从 LLM 原始文本提取 JSON：容忍 markdown 代码块 / 前后杂字，取首个 {...} 或 [...] 段
export function extractJSON(raw: string): unknown {
  let text = raw.trim()
  // 去掉 ```json ... ``` 围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  // 找到第一个 { 或 [ 起的完整 JSON 段
  const start = text.search(/[\[{]/)
  if (start < 0) throw new Error(`无 JSON 片段：${raw.slice(0, 120)}`)
  const first = text[start]
  const open = first === '{' ? '{' : '['
  const close = first === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) return JSON.parse(text.slice(start, i + 1)) }
  }
  throw new Error(`JSON 未闭合：${raw.slice(0, 120)}`)
}

export async function generateStructuredJSON<T>(
  opts: GenerateStructuredOptions,
): Promise<GenerateStructuredResult<T>> {
  const order = opts.providerOrder ?? DEFAULT_ORDER
  // 明确要求模型「只输出 JSON、不要代码块」，减少解析失败
  const system = `${opts.system}\n\n硬性要求：只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。`
  const errors: string[] = []
  for (const name of order) {
    const provider = opts.providerOverrides?.[name] ?? PROVIDERS[name]
    if (!provider) continue
    try {
      const raw = await provider.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: opts.user },
        ],
        // timeoutMs 不强制默认：未传时放行 provider 各自默认（ds 60s / minimax 120s）。
        // 原 60s 会覆盖 minimax 的 120s，导致长 JSON（40 道）生成超时中断（第 20 批终核抓到）。
        { temperature: opts.temperature ?? 0.3, timeoutMs: opts.timeoutMs },
      )
      const parsed = extractJSON(raw)
      const check = opts.schema.safeParse(parsed)
      if (!check.success) {
        errors.push(`${name}: zod 校验失败 ${check.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}=${i.message}`).join(';')}`)
        continue
      }
      return { ok: true, data: check.data as T, modelUsed: name }
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}`)
    }
  }
  return { ok: false, error: errors.join(' | ') || '无可用 provider' }
}

export type { ZodType, z }
