// 平台级敏感配置加密（2026-08-29 设置中心扩展）：AES-256-GCM，密钥由 AUTH_SECRET 经 HKDF-SHA256 派生。
// 与 lib/totp.ts 的 totpSecret 加密同思路（totp.ts 保持不动，本模块独立用途，避免密钥上下文混用）。
// 用于：AI key / OAuth clientSecret / SMTP 密码 / 支付网关密钥 等平台设置敏感字段。
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

// HKDF 派生用上下文（区分用途：totp 是 shop-engine/totp-secret:v1，此处独立）
const GCM_KEY_INFO = 'shop-engine/platform-secret:v1'

function deriveKey(): Buffer {
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) throw new Error('AUTH_SECRET 未配置，无法加解密平台敏感配置')
  return Buffer.from(hkdfSync('sha256', Buffer.from(authSecret), Buffer.alloc(0), GCM_KEY_INFO, 32))
}

// 加密：格式 iv(12B) + authTag(16B) + ciphertext，整体 base64（与 totp.ts 同格式，可互认）
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, 'base64')
  if (buf.length < 28) throw new Error('平台敏感配置密文格式非法')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
