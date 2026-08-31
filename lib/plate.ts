// 车牌 normalize：越南格式 29-A1 123.45 → 统一存 29A112345（去空格/连字符/点、大写）
// 存储与查询统一先 normalize 再精确匹配（OCR 与手输两种输入归一，见计划 10.4）
export function normalizePlate(raw?: string | null): string {
  if (!raw) return ''
  return String(raw)
    .toUpperCase()
    .replace(/[\s\-.]/g, '')
}
