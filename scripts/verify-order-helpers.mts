// 隔离验证 lib/order-shared.ts::lockOrderForUpdate / dismissOrderReminders（mock tx / monkey-patch，不产生真库副作用）
import { lockOrderForUpdate, dismissOrderReminders } from '@/lib/order-shared'

function assert(c: boolean, m: string) {
  if (!c) throw new Error(`FAIL: ${m}`)
}

async function run() {
  // 1) lockOrderForUpdate：捕获 tx.$queryRaw 的 SQL 片段 + 参数
  let c0 = '',
    c1 = '',
    val: any
  const tx = {
    $queryRaw: async (s: any, v: any) => {
      c0 = String(s[0])
      c1 = String(s[1])
      val = v
    },
  }
  await lockOrderForUpdate(tx as any, 'order_101')
  assert(c0.includes('SELECT id FROM "Order" WHERE id = '), `SQL 头不对: ${c0}`)
  assert(c1.includes('FOR UPDATE'), '缺 FOR UPDATE')
  assert(val === 'order_101', `锁参数不对: ${val}`)
  console.log('✓ lockOrderForUpdate SQL/参数正确（锁 Order 行）')

  // 2) dismissOrderReminders：monkey-patch prisma.reminder.updateMany 捕获 args（返回 0 行，无副作用）
  const { prisma } = await import('@/lib/prisma')
  const calls: any[] = []
  ;(prisma.reminder as any).updateMany = async (a: any) => {
    calls.push(a)
    return { count: 0 }
  }
  await dismissOrderReminders('order_1', ['FOOD_NEW_ORDER', 'FOOD_READY', 'FOOD_ADD'])
  await dismissOrderReminders('order_2', ['FOOD_ADD'])
  assert(calls.length === 2, `应捕获 2 次调用，实得 ${calls.length}`)
  const [c2, c3] = calls
  assert(
    JSON.stringify(c2.where.templateKey.in) ===
      JSON.stringify(['FOOD_NEW_ORDER', 'FOOD_READY', 'FOOD_ADD']),
    '3-key in 列表',
  )
  assert(
    c2.where.orderId === 'order_1' &&
      c2.where.status === 'PENDING' &&
      c2.data.status === 'DISMISSED',
    '3-key where/data',
  )
  assert(JSON.stringify(c3.where.templateKey.in) === JSON.stringify(['FOOD_ADD']), '1-key in 列表')
  console.log('✓ dismissOrderReminders 3-key/1-key where/data 正确')

  console.log('ALL PASS — lockOrderForUpdate + dismissOrderReminders')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
