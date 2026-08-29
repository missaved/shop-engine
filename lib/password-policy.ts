// 密码策略（第 20 批 A3 + 8.2）：admin 强策略 / 店主宽松策略，两人两套
// 返回错误码（i18n key），null = 通过；调用方负责翻译与展示。
// - admin：≥12 位，须含大写 / 小写 / 数字 / 符号（平台账号爆破面大，从严）
// - 店主：≥8 位，字母 + 数字（手机端不苛刻，用户拍板「店主宽松」）

// admin 密码校验 → null 通过，否则返回错误码
export function validateAdminPassword(pwd: string): string | null {
  if (pwd.length < 12) return 'adminPasswordTooShort'
  if (!/[a-z]/.test(pwd)) return 'adminPasswordNeedLower'
  if (!/[A-Z]/.test(pwd)) return 'adminPasswordNeedUpper'
  if (!/\d/.test(pwd)) return 'adminPasswordNeedDigit'
  if (!/[^A-Za-z0-9]/.test(pwd)) return 'adminPasswordNeedSymbol'
  return null
}

// 店主密码校验 → null 通过，否则返回错误码
export function validateOwnerPassword(pwd: string): string | null {
  if (pwd.length < 8) return 'ownerPasswordTooShort'
  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) return 'ownerPasswordWeak'
  return null
}
