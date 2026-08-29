// @ts-nocheck — A2 mock 单测（非交付）：fallback 链 + JSON 提取 + zod 校验
import { generateStructuredJSON, extractJSON } from '../lib/llm/generate'
import { DishBatchSchema } from '../lib/llm/prompts'
import { z } from 'zod'

let pass = 0
let fail = 0
const ok = (cond: boolean, label: string) => {
  if (cond) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

// 1) extractJSON：markdown 围栏 / 前后杂字
const t1 = extractJSON('```json\n{"a":1}\n```')
ok(JSON.stringify(t1) === '{"a":1}', 'extractJSON 去 markdown 围栏')
const t2 = extractJSON('好的，这是结果：{"dishes":[]} 完毕')
ok(JSON.stringify(t2) === '{"dishes":[]}', 'extractJSON 容忍前后杂字')

// 2) mock：ds 返回坏 JSON → 自动切 minimax 成功
const schema = z.object({ dishes: z.array(z.object({ name: z.string() })).min(1) })
const r1 = await generateStructuredJSON({
  system: 'test',
  user: 'x',
  schema,
  providerOverrides: {
    ds: { name: 'ds', chat: async () => '这不是 JSON，乱写一通' },
    minimax: { name: 'minimax', chat: async () => '{"dishes":[{"name":"Pho"}]}' },
  },
})
ok(r1.ok && r1.modelUsed === 'minimax', `ds 坏 JSON → 切 minimax 成功 (model=${r1.ok ? r1.modelUsed : 'N/A'})`)

// 3) 校验缺必填字段 → 拒绝
const r2 = await generateStructuredJSON({
  system: 'test',
  user: 'x',
  schema,
  providerOverrides: {
    ds: { name: 'ds', chat: async () => '{"dishes":[{"price":1}]}' }, // 缺 name
  },
})
ok(!r2.ok, '缺必填字段被拒绝')

// 4) 全部失败 → 返回 error
const r3 = await generateStructuredJSON({
  system: 'test',
  user: 'x',
  schema,
  providerOrder: ['ds', 'minimax'],
  providerOverrides: {
    ds: { name: 'ds', chat: async () => { throw new Error('boom') } },
    minimax: { name: 'minimax', chat: async () => 'nope' },
  },
})
ok(!r3.ok, '全部失败 → ok:false')

// 5) DishBatchSchema 校验一组真实形状
const dish = {
  nativeName: 'Phở bò', name_en: 'Beef pho', name_zh: '牛肉河粉',
  description_local: 'Nước dùng đậm đà', description_en: 'Rich broth',
  defaultPrice: 40000, extras: ['Trứng', 'Thịt bò thêm'], allergens: [], dietaryTags: ['spicy'],
  imagePrompt: 'steaming bowl of beef pho on wooden table',
}
const r5 = DishBatchSchema.safeParse({ dishes: [dish] })
ok(r5.success, 'DishBatchSchema 正常数据通过')
const r5b = DishBatchSchema.safeParse({ dishes: [{ ...dish, defaultPrice: 40000.5 }] })
ok(!r5b.success, 'DishBatchSchema 非整价格拒绝')

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
