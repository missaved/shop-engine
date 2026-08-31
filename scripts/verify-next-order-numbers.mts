// 隔离验证 lib/order-shared.ts::nextOrderNumbers 的取号/前缀/序号派生逻辑（不碰真库，mock tx）
// 重点：lastSeq 从「当日最后一张 displayNo 序号」解析而非 count+1（防空洞撞号 P2002）
import { nextOrderNumbers } from '@/lib/order-shared'

const now = new Date('2026-08-31T12:00:00Z')

async function run() {
  // 场景 A：当日已有 CP-260831-005，全局 max orderNo=42 → 应产出 CP-260831-006、orderNo=43
  let findWhere: any = null
  let aggWhere: any = null
  const txA = {
    order: {
      aggregate: async (a: any) => {
        aggWhere = a.where
        return { _max: { orderNo: 42 } }
      },
      findFirst: async (a: any) => {
        findWhere = a.where
        return { displayNo: 'CP-260831-005' }
      },
    },
  }
  const a = await nextOrderNumbers(txA as any, 'shop1', 'CP', now)
  if (a.orderNo !== 43) throw new Error(`orderNo 期望 43 实得 ${a.orderNo}`)
  if (a.displayNo !== 'CP-260831-006') throw new Error(`displayNo 期望 CP-260831-006 实得 ${a.displayNo}`)
  if (a.dayPrefix !== '260831') throw new Error(`dayPrefix 期望 260831 实得 ${a.dayPrefix}`)
  if (findWhere?.displayNo?.startsWith !== 'CP-260831-') throw new Error('findFirst 未按当日前缀查询')
  console.log('✓ 场景A：当日有单 → 序号 +1（CP-260831-006 / orderNo 43）')

  // 场景 B：当日无单（findFirst 返回 null），全局 orderNo=0 → MT-260831-001、orderNo=1
  const txB = {
    order: {
      aggregate: async () => ({ _max: { orderNo: 0 } }),
      findFirst: async () => null,
    },
  }
  const b = await nextOrderNumbers(txB as any, 'shop1', 'MT', now)
  if (b.displayNo !== 'MT-260831-001') throw new Error(`MT displayNo 期望 MT-260831-001 实得 ${b.displayNo}`)
  if (b.orderNo !== 1) throw new Error(`orderNo 期望 1 实得 ${b.orderNo}`)
  console.log('✓ 场景B：当日无单 → 序号 001（MT-260831-001 / orderNo 1）')

  // 场景 C：空洞撞号防护——当日最后一张是 -005 而非 count=3，仍应取 -006（防 count+1 得出 -004 撞已存在单）
  const txC = {
    order: {
      aggregate: async () => ({ _max: { orderNo: 5 } }),
      findFirst: async () => ({ displayNo: 'CP-260831-005' }),
    },
  }
  const c = await nextOrderNumbers(txC as any, 'shop1', 'CP', now)
  if (c.displayNo !== 'CP-260831-006') throw new Error(`空洞场景 期望 -006 实得 ${c.displayNo}`)
  console.log('✓ 场景C：空洞 → 从最后一张 displayNo 序号派生（-006）而非 count+1')

  console.log('ALL PASS — nextOrderNumbers 取号/前缀/序号逻辑正确')
}

run().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
