// 金额显示格式化（多币种）：按币种决定符号位置与简写
// VND（越南盾）：整千金额转 k 后缀 + 后缀 đ（10000 → 10kđ），其余千分位 + đ（10.500đ）
// 其他币种：符号前置 + 千分位（USD → $1,000 / EUR → €1,000 / SGD → S$1,000 / CNY → ¥1,000）
// 返回完整带符号字符串，调用点不再手动拼符号
const SYMBOL: Record<string, string> = {
  VND: 'đ',
  USD: '$',
  EUR: '€',
  SGD: 'S$',
  CNY: '¥',
}

export function formatPrice(amount: number, currency = 'VND'): string {
  if (currency === 'VND') {
    if (amount > 0 && amount % 1000 === 0) return `${amount / 1000}kđ`
    return `${amount.toLocaleString('vi-VN')}đ`
  }
  const sym = SYMBOL[currency] ?? ''
  return `${sym}${amount.toLocaleString('en-US')}`
}
