// DeepSeek provider：文字生成主力（8.1 定案）。OpenAI 兼容 chat/completions
// 2026-08-29：key/模型改读平台配置（DB 优先，env 回退）
import type { LLMProvider } from './provider'
import { getAiConfig } from '@/lib/platform-settings'

export const deepseek: LLMProvider = {
  name: 'ds',
  async chat(messages, opts) {
    const { key, model } = (await getAiConfig()).deepseek
    if (!key) throw new Error('ds: DEEPSEEK_API_KEY 未配置')
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, // 实测返回 deepseek-v4-flash
        messages,
        temperature: opts?.temperature ?? 0.3,
        max_tokens: 8192, // 菜品 JSON 含三语描述/图 prompt，默认上限会截断
        stream: false,
      }),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 60_000),
    })
    const j = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[]
      error?: { message?: string }
    }
    if (!res.ok) throw new Error(`ds HTTP ${res.status}: ${j.error?.message ?? JSON.stringify(j).slice(0, 200)}`)
    const content = j.choices?.[0]?.message?.content
    if (!content) throw new Error('ds: 响应无 content')
    return content
  },
}
