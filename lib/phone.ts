// 客户手机号归一化：统一存/查格式，避免 +86 与裸号、含空格/连字符写法互相查不到
// （下单存 +8613800138000、查单填 13800138000 时，原全链路精确匹配必 notFound）。
// 规则：去空格/连字符/括号 → 去 + 国码 → 越南国际写法 84 统一为 0 开头本地号、中国国际写法 86 去国码。

export function normalizePhone(raw?: string | null): string {
  if (!raw) return ''
  let p = String(raw)
    .trim()
    .replace(/[\s\-()]/g, '')
  if (!p) return ''
  if (p.startsWith('+')) p = p.slice(1)
  // 非纯数字不做国码换算，原样返回交给格式正则校验
  if (!/^\d+$/.test(p)) return p
  // 越南国际写法：84 前缀 → 0 开头本地号（补 0 并去 0 冗余，兼容 84+本地号两种输入）
  if (p.startsWith('84') && p.length >= 11) {
    p = '0' + p.slice(2).replace(/^0+/, '')
  }
  // 中国国际写法：86 前缀（86+11 位）→ 裸 11 位
  else if (p.startsWith('86') && p.length === 13) {
    p = p.slice(2)
  }
  return p
}
