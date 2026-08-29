// 密码策略（第 20 批 A3 + 8.2 + 2026-08-29 用户拍板）：admin / 店主统一宽松，靠登录失败锁定防爆破
// 返回错误码（i18n key），null = 通过；调用方负责翻译与展示。
// - admin：≥8 位，字母 + 数字（2026-08-29 用户决策「商户8位密码即可，爆破靠登录失败锁定」）
// - 店主：≥8 位，字母 + 数字（手机端不苛刻）

// admin 密码校验 → null 通过，否则返回错误码
export function validateAdminPassword(pwd: string): string | null {
  if (pwd.length < 8) return 'adminPasswordTooShort'
  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) return 'adminPasswordWeak'
  return null
}

// 店主密码校验 → null 通过，否则返回错误码
export function validateOwnerPassword(pwd: string): string | null {
  if (pwd.length < 8) return 'ownerPasswordTooShort'
  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) return 'ownerPasswordWeak'
  return null
}
