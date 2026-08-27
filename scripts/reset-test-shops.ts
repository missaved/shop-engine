// 重置 3 家测试店状态:open=true
// 用于测试脚本开始前确保营业开关恢复
import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

async function main() {
  const a = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const p = new PrismaClient({ adapter: a })
  const r = await p.shop.updateMany({ data: { open: true } })
  console.log(`✅ 重置 ${r.count} 家店为营业中`)
  await p.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })