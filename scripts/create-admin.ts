// 运维建平台运营账号（第 20 批审计修复 + 审计对齐拍板）：密码宽松策略 ≥8 位（爆破靠登录失败锁定）
// 用法：cd /root/shop-saas/app && pnpm tsx scripts/create-admin.ts --phone=0900000000 --password=<≥8位>
// seed.ts 里的 demo admin（demo1234）仅限本地演示；生产建 admin 走此脚本（validateAdminPassword 强制校验）
import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'bcryptjs'
import { validateAdminPassword } from '../lib/password-policy'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

function parseArg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

async function main() {
  const phone = parseArg('phone')
  const password = parseArg('password')
  if (!phone || !password) {
    console.error('用法: pnpm tsx scripts/create-admin.ts --phone=<phone> --password=<≥8位密码> [--username=<登录名>]')
    process.exit(1)
  }
  const username = parseArg('username') ?? `admin${phone.slice(-4)}`
  const err = validateAdminPassword(password)
  if (err) {
    console.error(`拒绝：密码不满足平台账号策略（${err}）——≥8 位即可`)
    process.exit(1)
  }
  const pwdHash = await hash(password, 10)
  const admin = await prisma.user.upsert({
    where: { phone },
    update: { passwordHash: pwdHash, role: 'ADMIN', username },
    create: { phone, passwordHash: pwdHash, name: '平台运营', role: 'ADMIN', username },
  })
  console.log(`✅ 平台运营账号 ${phone} 就绪（用户名 ${username}，强密码策略已强制校验）`)
}

main().finally(() => prisma.$disconnect())
