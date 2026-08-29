// TOTP 紧急重置（第 20 批审计修复）：admin 丢验证器/换手机时运维重置入口
// 用法：cd /root/shop-saas/app && pnpm tsx scripts/reset-admin-totp.ts --phone=0900000000 --key=<TOTP_MASTER_KEY>
// key 必须与 .env 的 TOTP_MASTER_KEY 严格相等，防未授权滥用；重置后不打印 secret，
// admin 重新登录走绑定引导（A4 流程），不泄露旧验证码
import 'dotenv/config'
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

function parseArg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

async function main() {
  const phone = parseArg('phone')
  const key = parseArg('key')
  const master = process.env.TOTP_MASTER_KEY
  if (!phone || !key || !master) {
    console.error('用法: pnpm tsx scripts/reset-admin-totp.ts --phone=<phone> --key=<TOTP_MASTER_KEY>')
    console.error('（TOTP_MASTER_KEY 在 .env 配置，运维持有）')
    process.exit(1)
  }
  if (key !== master) {
    console.error('拒绝：授权 key 不匹配（请核对 .env 的 TOTP_MASTER_KEY）')
    process.exit(1)
  }
  const admin = await prisma.user.findUnique({ where: { phone } })
  if (!admin || admin.role !== 'ADMIN') {
    console.error(`拒绝：${phone} 不是平台运营账号（ADMIN）`)
    process.exit(1)
  }
  await prisma.user.update({
    where: { id: admin.id },
    data: { totpEnabled: false, totpSecret: null },
  })
  console.log(`✅ ${phone} 的 TOTP 已重置。该账号下次登录将重新走绑定引导（不打印旧 secret）`)
}

main().finally(() => prisma.$disconnect())
