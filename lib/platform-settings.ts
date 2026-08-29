// 平台级设置读写（2026-08-29 设置中心扩展）：PlatformSetting 键值表 → 业务封装。
// 敏感字段（字段名以 Key/Secret/Password 结尾）AES 加密落库（lib/secret-crypto.ts），
// 读取时解密；AI key 提供 env 回退（DB 无配置时兼容现状 dev）。
import { prisma } from '@/lib/prisma'
import { encryptSecret, decryptSecret } from '@/lib/secret-crypto'

// ---- 通用键值读写 ----

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key } })
  return (row?.value as T | undefined) ?? null
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value: value as object },
    create: { key, value: value as object },
  })
}

// ---- 敏感字段加解密（递归；字段名以 Key/Secret/Password/secret 结尾 → 加密值）----

const SENSITIVE_KEY = /(Key|Secret|Password|secret)$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function encryptSensitiveValues<T>(obj: T): T {
  if (!isPlainObject(obj)) return obj
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY.test(k) && typeof v === 'string' && v.length > 0) {
      // 传入值一律视为「要设置的明文」→ 加密（UI 读取接口不返回明文，不存在回传密文场景）
      out[k] = encryptSecret(v)
    } else if (isPlainObject(v)) {
      out[k] = encryptSensitiveValues(v)
    } else {
      out[k] = v
    }
  }
  return out as T
}

export function decryptSensitiveValues<T>(obj: T): T {
  if (!isPlainObject(obj)) return obj
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY.test(k) && typeof v === 'string' && v.length > 0) {
      try {
        out[k] = decryptSecret(v)
      } catch {
        out[k] = v // 解密失败（非密文）→ 原样返回
      }
    } else if (isPlainObject(v)) {
      out[k] = decryptSensitiveValues(v)
    } else {
      out[k] = v
    }
  }
  return out as T
}

// ---- AI 配置（provider 用）：DB 优先，env 回退 ----

export type AiProviderConfig = { key: string | null; model: string }

export type AiConfig = {
  minimax: AiProviderConfig
  deepseek: AiProviderConfig
  gemini: AiProviderConfig
}

const DEFAULT_MODELS: Record<'minimax' | 'deepseek' | 'gemini', string> = {
  minimax: 'abab6.5s-chat',
  deepseek: 'deepseek-chat',
  gemini: 'gemini-3.6-flash',
}

// provider 每次调用读一次 DB（低频；AI 调用本身耗时，缓存收益低）
export async function getAiConfig(): Promise<AiConfig> {
  const raw = await getSetting<Record<string, string>>('ai')
  const cfg = decryptSensitiveValues(raw ?? {})
  const env: Record<string, string | undefined> = {
    minimax: process.env.MINIMAX_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  }
  const pick = (name: 'minimax' | 'deepseek' | 'gemini'): AiProviderConfig => ({
    key: cfg[`${name}Key`] || env[name] || null,
    model: cfg[`${name}Model`] || DEFAULT_MODELS[name],
  })
  return { minimax: pick('minimax'), deepseek: pick('deepseek'), gemini: pick('gemini') }
}
