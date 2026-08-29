// Gemini provider：最后兜底（8.1 定案「实在不行才用」）
// Gemini 无 system 角色，system 消息折进 systemInstruction
import type { LLMProvider, ChatMessage } from './provider'

export const gemini: LLMProvider = {
  name: 'gemini',
  async chat(messages, opts) {
    const key = process.env.GEMINI_API_KEY
    if (!key) throw new Error('gemini: GEMINI_API_KEY 未配置')
    // 拆分 system 消息 → systemInstruction；其余 → contents
    const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const rest: ChatMessage[] = messages.filter((m) => m.role !== 'system')
    const contents = rest.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user', // Gemini 角色名：user / model
      parts: [{ text: m.content }],
    }))
    const body: Record<string, unknown> = { contents }
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(key)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 60_000),
    })
    const j = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
      error?: { message?: string }
    }
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${j.error?.message ?? JSON.stringify(j).slice(0, 200)}`)
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (!text) throw new Error('gemini: 响应无文本')
    return text
  },
}
