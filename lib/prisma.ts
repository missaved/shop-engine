// Prisma Client 单例（Prisma 7 + driver adapter，Next dev 热重载下避免连接泄漏）
import 'dotenv/config' // Next 已自动加载 .env，此处兜底 tsx 等脚本场景（幂等）
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
})

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
