// 金额显示格式化（越南盾）：整千金额转 k 后缀（10000 → 10k），其余保留千分位
// 越南盾商品价几乎都是整千，k 后缀比「10.000đ」更短、扫读更快
export function formatPrice(vnd: number): string {
  if (vnd > 0 && vnd % 1000 === 0) return `${vnd / 1000}k`
  return vnd.toLocaleString('vi-VN')
}
