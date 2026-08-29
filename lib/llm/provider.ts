// LLM provider 统一接口（第 19 批 A2）
// 分工（8.1 定案）：ds = 文字主力；minimax = 文字兜底 + 文生图；gemini = 最后兜底
// 新增 provider = 实现本接口并注册到 index.ts 的 PROVIDERS 即可，fallback 链逻辑不用改

export type LLMProviderName = 'ds' | 'minimax' | 'gemini'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  /** 单次请求超时，默认 60s */
  timeoutMs?: number
}

export interface LLMProvider {
  name: LLMProviderName
  /** 聊天补全，返回纯文本内容；失败抛错（由 fallback 链捕获并切换下一个） */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>
}
