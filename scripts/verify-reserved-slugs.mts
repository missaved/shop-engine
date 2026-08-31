// 验证 lib/vertical.ts::RESERVED_SHOP_SLUGS 单点定义的内容正确（防旧 /s 残留、含垂直短码、示例 slug 不误禁）
import { RESERVED_SHOP_SLUGS, VERTICAL_SLUG } from '@/lib/vertical'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

// 1. 已删的 s 不再保留（/s 前缀已被删除，无过渡）
assert(!RESERVED_SHOP_SLUGS.has('s'), "已删除的 's' 不应再保留")

// 2. 5 个垂直短码全部保留（防店 slug 撞垂直短码，语义混淆）
for (const slug of Object.values(VERTICAL_SLUG)) {
  assert(RESERVED_SHOP_SLUGS.has(slug), `垂直短码 '${slug}' 应在保留集合`)
}
assert(RESERVED_SHOP_SLUGS.has('lookup'), "'lookup' 子路径应保留")

// 3. 常规合法 slug 不应误禁（建店校验核心用例）
for (const ok of ['demo-pho', 'demo-moto', 'pho-nghia', 'moto-hai', 'viet-noodles']) {
  assert(!RESERVED_SHOP_SLUGS.has(ok), `合法 slug '${ok}' 不应被保留`)
}

// 4. 保留字确实被误禁（建店校验的负例）
for (const bad of ['admin', 'login', 'dashboard', 'api', 'food', 'moto', 'salon', 'pet', 'laundry', 'lookup']) {
  assert(RESERVED_SHOP_SLUGS.has(bad), `保留字 '${bad}' 应在集合`)
}

console.log(
  `✓ RESERVED_SHOP_SLUGS 内容正确（大小 ${RESERVED_SHOP_SLUGS.size}，含 ${Object.values(VERTICAL_SLUG).join('/')} 垂直短码 + locale/静态段/子路径，s 已移除）`,
)
console.log('ALL PASS')
