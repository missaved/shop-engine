// 中台 server actions：建店 / 停用启用 / 推荐位 / 删除 / 重置密码
// 授权模型：全部 requireAdmin()（ADMIN 天然有权操作任意店），不复用 assertShopOwned（那是「行属于当前租户」校验，ADMIN 无租户，误用会 404）
// 店内数据直接按传入 shopId 查，找不到 throw
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireAdmin } from '@/lib/dal'
import { hash } from 'bcryptjs'
import { addMonths } from '@/lib/billing'

// slug 保留字黑名单：与路由 / 静态资源名冲突的词（/s/[slug] 客户菜单、/admin、/login 等）
const RESERVED_SLUGS = new Set([
  'admin',
  'login',
  'dashboard',
  'api',
  's',
  'track',
  'zh',
  'zh-hant',
  'en',
  'vi',
  'ms',
  'th',
  'manifest',
  'sw',
])

// slug 服务端校验：小写字母数字 + 连字符、不以连字符开头/结尾、长度 3–30、不含保留字
function assertValidSlug(slug: string): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('slug 只能是小写字母、数字、连字符，且不以连字符开头或结尾')
  }
  if (slug.length < 3 || slug.length > 30) throw new Error('slug 长度须为 3–30 位')
  if (RESERVED_SLUGS.has(slug)) throw new Error('该 slug 为保留字，请换一个')
}

// 建店 + 老板账号（一个事务）：校验 slug/phone 唯一，试用期天数 >0 时设 subscribedUntil
export async function createShop(input: {
  slug: string
  name: string
  vertical: 'FOOD'
  currency: string
  phone: string | null
  address: string | null
  openHours: string | null
  minOrderAmount: number
  plan: string
  trialDays: number
  nameI18n: Record<string, string>
  ownerPhone: string
  ownerPassword: string
}): Promise<void> {
  await requireAdmin()
  const {
    slug,
    name,
    vertical,
    currency,
    phone,
    address,
    openHours,
    minOrderAmount,
    plan,
    trialDays,
    nameI18n,
    ownerPhone,
    ownerPassword,
  } = input

  try {
    assertValidSlug(slug.trim())
    if (!name.trim()) throw new Error('店名不能为空')
    if (vertical !== 'FOOD') throw new Error('当前仅支持 FOOD 类目')
    if (!ownerPhone.trim()) throw new Error('老板手机号不能为空')
    if (!ownerPassword || ownerPassword.length < 6) throw new Error('老板初始密码至少 6 位')

    // 查重：slug / 老板手机号唯一（P2002 兜底）
    const [slugTaken, phoneTaken] = await Promise.all([
      prisma.shop.findUnique({ where: { slug: slug.trim() } }),
      prisma.user.findUnique({ where: { phone: ownerPhone.trim() } }),
    ])
    if (slugTaken) throw new Error('该 slug 已被占用')
    if (phoneTaken) throw new Error('该老板手机号已注册')

    // 试用期：>0 天 → now + trialDays；0 → 无期限（null）
    const subscribedUntil =
      trialDays > 0 ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null

    const config: Prisma.InputJsonValue = {
      ...(openHours ? { openHours } : {}),
      ...(minOrderAmount > 0 ? { minOrderAmount } : {}),
      ...(Object.keys(nameI18n).length ? { nameI18n } : {}),
    }

    await prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          slug: slug.trim(),
          name: name.trim(),
          vertical,
          currency,
          phone: phone?.trim() || null,
          address: address?.trim() || null,
          plan,
          subscribedUntil,
          config,
        },
      })
      await tx.user.create({
        data: {
          shopId: shop.id,
          phone: ownerPhone.trim(),
          passwordHash: await hash(ownerPassword, 10),
          name: '老板',
          role: 'OWNER',
        },
      })
    })

    revalidatePath('/[locale]/admin', 'page')
  } catch (e) {
    // P2002 唯一冲突兜底（并发下 findUnique 查重可能漏）
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      console.error('建店失败（唯一冲突）:', e)
      throw new Error('slug 或老板手机号已存在')
    }
    console.error('建店失败（slug=%s）:', slug, e)
    throw e
  }
}

// 平台停用 / 启用（违规冻结，独立于老板 open 打烊）
export async function togglePlatformSuspended(shopId: string): Promise<void> {
  await requireAdmin()
  try {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } })
    if (!shop) throw new Error('店铺不存在')
    await prisma.shop.update({
      where: { id: shopId },
      data: { platformSuspended: !shop.platformSuspended },
    })
    revalidatePath('/[locale]/admin', 'page')
  } catch (e) {
    console.error('切换平台停用失败（shopId=%s）:', shopId, e)
    throw e
  }
}

// 推荐位开 / 关（聚合首页排序用）
export async function toggleFeatured(shopId: string): Promise<void> {
  await requireAdmin()
  try {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } })
    if (!shop) throw new Error('店铺不存在')
    await prisma.shop.update({
      where: { id: shopId },
      data: { featured: !shop.featured },
    })
    revalidatePath('/[locale]/admin', 'page')
  } catch (e) {
    console.error('切换推荐位失败（shopId=%s）:', shopId, e)
    throw e
  }
}

// 删除店铺（级联删 products/orders/reminders/users/billings，危险操作，前端二次确认）
export async function deleteShop(shopId: string): Promise<void> {
  await requireAdmin()
  try {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } })
    if (!shop) throw new Error('店铺不存在')
    await prisma.shop.delete({ where: { id: shopId } })
    revalidatePath('/[locale]/admin', 'page')
  } catch (e) {
    console.error('删除店铺失败（shopId=%s）:', shopId, e)
    throw e
  }
}

// 重置该店老板密码
export async function resetOwnerPassword(
  shopId: string,
  newPassword: string,
): Promise<void> {
  await requireAdmin()
  try {
    if (!newPassword || newPassword.length < 6) throw new Error('新密码至少 6 位')
    const owner = await prisma.user.findFirst({ where: { shopId, role: 'OWNER' } })
    if (!owner) throw new Error('该店无老板账号')
    await prisma.user.update({
      where: { id: owner.id },
      data: { passwordHash: await hash(newPassword, 10) },
    })
    revalidatePath('/[locale]/admin', 'page')
  } catch (e) {
    console.error('重置密码失败（shopId=%s）:', shopId, e)
    throw e
  }
}

// 续费：$transaction 写 Billing 流水 + 推进 subscribedUntil（现有到期未来日 +months，否则从 now 起算），并更新套餐档位
export async function renewSubscription(input: {
  shopId: string
  plan: string
  months: number
  amount: number
  note?: string
}): Promise<void> {
  const admin = await requireAdmin()
  const { shopId, plan, months, amount, note } = input
  try {
    if (!Number.isInteger(months) || months <= 0) throw new Error('续费月数须为正整数')
    if (!Number.isFinite(amount) || amount < 0) throw new Error('金额无效')

    const shop = await prisma.shop.findUnique({ where: { id: shopId } })
    if (!shop) throw new Error('店铺不存在')

    // 新到期日：现有未过期时在到期日基础上续，否则（无期限/已过期）从 now 起算
    const base =
      shop.subscribedUntil && shop.subscribedUntil.getTime() > Date.now()
        ? shop.subscribedUntil
        : new Date()
    const newUntil = addMonths(base, months)

    await prisma.$transaction(async (tx) => {
      await tx.billing.create({
        data: {
          shopId,
          plan,
          amount: new Prisma.Decimal(amount),
          months,
          note: note?.trim() || null,
          createdBy: admin.name ?? 'admin',
        },
      })
      await tx.shop.update({
        where: { id: shopId },
        data: { subscribedUntil: newUntil, plan },
      })
    })

    revalidatePath('/[locale]/admin', 'page')
  } catch (e) {
    console.error('续费失败（shopId=%s）:', shopId, e)
    throw e
  }
}
