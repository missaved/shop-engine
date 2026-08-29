// MiniMax provider：文字兜底（8.1 定案，ds 保文字、minimax 文字不押注）
// 国内版 key（sk-cp-）必须用 api.minimaxi.com，国际版用 api.minimax.io（经验见 scripts/generate-voices.mjs）
import type { LLMProvider } from './provider'

const base = (key: string) => (key.startsWith('sk-cp-') ? 'https://api.minimaxi.com' : 'https://api.minimax.io')

export const minimax: LLMProvider = {
  name: 'minimax',
  async chat(messages, opts) {
    const key = process.env.MINIMAX_API_KEY
    if (!key) throw new Error('minimax: MINIMAX_API_KEY 未配置')
    const res = await fetch(`${base(key)}/v1/text/chatcompletion_v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'abab6.5s-chat',
        messages,
        temperature: opts?.temperature ?? 0.3,
        max_tokens: 8192, // 默认输出上限低，长 JSON 会截断
      }),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 120_000), // minimax 有限流/较慢，放宽到 120s
    })
    const j = (await res.json().catch(() => ({}))) as {
      base_resp?: { status_code?: number; status_msg?: string }
      choices?: { message?: { content?: string } }[]
    }
    const code = j.base_resp?.status_code
    if (!res.ok || (code !== undefined && code !== 0))
      throw new Error(`minimax 状态码 ${code ?? res.status}: ${j.base_resp?.status_msg ?? JSON.stringify(j).slice(0, 200)}`)
    const content = j.choices?.[0]?.message?.content
    if (!content) throw new Error('minimax: 响应无 content')
    return content
  },
}
