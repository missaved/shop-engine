// TOTP（RFC 6238）自实现 + totpSecret 加密存储
// 第 20 批 A2：为 admin 二次验证提供零依赖 TOTP（HMAC-SHA1 / 30s / 6 位，window ±1）。
// 存储加密：AES-256-GCM，密钥由 AUTH_SECRET 经 HKDF-SHA256 派生（不落盘明文、可随 AUTH_SECRET 轮换）。
import { createHmac, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOTP_STEP = 30 // 时间步长（秒）
const TOTP_DIGITS = 6 // 验证码位数
const GCM_KEY_INFO = 'shop-engine/totp-secret:v1' // HKDF 派生用上下文（区分用途，避免与其他密钥混用）

// ---- base32（RFC 4648，Google Authenticator 格式）----

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error(`非法的 base32 字符: ${ch}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// 生成随机 secret（默认 20 字节 → 32 位 base32，与 Google Authenticator 兼容）
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes))
}

// ---- TOTP 核心 ----

// 指定 Unix 秒算 TOTP（RFC 6238：HMAC-SHA1(secret, counter) → 动态截断 → 6 位）
export function totpForTime(secretB32: string, seconds: number): string {
  const key = base32Decode(secretB32)
  const counter = Math.floor(seconds / TOTP_STEP)
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  return (bin % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0')
}

// 校验验证码（允许时间偏移 window 步，默认前后各 1 步 → 容忍 ±30s 时钟漂移）
export function verifyTOTP(secretB32: string, code: string, window = 1): boolean {
  const now = Math.floor(Date.now() / 1000)
  for (let i = -window; i <= window; i++) {
    if (totpForTime(secretB32, now + i * TOTP_STEP) === code) return true
  }
  return false
}

// otpauth URI（绑定引导展示 / QR 用）
export function otpauthURI(secret: string, account: string, issuer: string): string {
  return (
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP}`
  )
}

// ---- totpSecret 加密存储（AES-256-GCM）----

function deriveKey(): Buffer {
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) throw new Error('AUTH_SECRET 未配置，无法加解密 totpSecret')
  return Buffer.from(hkdfSync('sha256', Buffer.from(authSecret), Buffer.alloc(0), GCM_KEY_INFO, 32))
}

// 加密：格式 iv(12B) + authTag(16B) + ciphertext，整体 base64
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, 'base64')
  if (buf.length < 28) throw new Error('totpSecret 密文格式非法')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
