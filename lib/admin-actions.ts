// 中台 server actions：建店 / 停用启用 / 推荐位 / 删除 / 重置密码
// 授权模型：全部 requireAdmin()（ADMIN 天然有权操作任意店），不复用 assertShopOwned（那是「行属于当前租户」校验，ADMIN 无租户，误用会 404）
// 店内数据直接按传入 shopId 查，找不到 throw
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireAdmin } from '@/lib/dal'
import { compare, hash } from 'bcryptjs'
import { addMonths } from '@/lib/billing'
import { validateAdminPassword, validateOwnerPassword } from '@/lib/password-policy'
import {
  encryptSecret,
  decryptSecret,
  generateSecret,
  otpauthURI,
  verifyTOTP,
} from '@/lib/totp'

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

// 垂直类目（SaaS 附加的 App = 这些垂直；FOOD 先行，其余为模板扩展位）
// 注意：'use server' 文件只能导出 async 函数，对象/常量只能内部用（type 导出不受限）
export type Vertical = 'FOOD' | 'MOTO' | 'SALON' | 'PET' | 'LAUNDRY'
const VERTICALS: Vertical[] = ['FOOD', 'MOTO', 'SALON', 'PET', 'LAUNDRY']

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
  vertical: Vertical
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
    if (!VERTICALS.includes(vertical)) throw new Error('未知垂直类目')
    if (!ownerPhone.trim()) throw new Error('老板手机号不能为空')
    // 店主密码走宽松策略（≥8 位字母数字，8.2 决策：店主统一宽松，手机端不苛刻）
    if (!ownerPassword) throw new Error('老板初始密码不能为空')
    const ownerPwdErr = validateOwnerPassword(ownerPassword)
    if (ownerPwdErr) throw new Error('老板初始密码至少 8 位且含字母与数字')

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

    revalidatePath('/admin/[locale]/shops', 'page')
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
    revalidatePath('/admin/[locale]/shops', 'page')
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
    revalidatePath('/admin/[locale]/shops', 'page')
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
    revalidatePath('/admin/[locale]/shops', 'page')
  } catch (e) {
    console.error('删除店铺失败（shopId=%s）:', shopId, e)
    throw e
  }
}

// 重置该店老板密码（店主走宽松策略 ≥8 位字母数字）
export async function resetOwnerPassword(
  shopId: string,
  newPassword: string,
): Promise<void> {
  await requireAdmin()
  try {
    if (!newPassword) throw new Error('新密码不能为空')
    if (validateOwnerPassword(newPassword)) throw new Error('新密码至少 8 位且含字母与数字')
    const owner = await prisma.user.findFirst({ where: { shopId, role: 'OWNER' } })
    if (!owner) throw new Error('该店无老板账号')
    await prisma.user.update({
      where: { id: owner.id },
      data: { passwordHash: await hash(newPassword, 10) },
    })
    revalidatePath('/admin/[locale]/shops', 'page')
  } catch (e) {
    console.error('重置密码失败（shopId=%s）:', shopId, e)
    throw e
  }
}

// admin 改密（强策略 ≥12 位混合 + 旧密码校验）
export async function changeAdminPassword(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const session = await requireAdmin()
  try {
    if (!oldPassword || !newPassword) throw new Error('旧密码与新密码不能为空')
    const pwdErr = validateAdminPassword(newPassword)
    if (pwdErr) throw new Error('admin 新密码须 ≥12 位且含大小写字母、数字、符号')
    // requireAdmin 只给 session user（无 passwordHash），改密需重查 DB 校验旧密码
    const admin = await prisma.user.findUnique({ where: { id: session.id } })
    if (!admin) throw new Error('admin 账号不存在')
    const ok = await compare(oldPassword, admin.passwordHash)
    if (!ok) throw new Error('旧密码不正确')
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await hash(newPassword, 10) },
    })
    revalidatePath('/admin/[locale]/shops', 'page')
  } catch (e) {
    console.error('admin 改密失败:', e)
    throw e
  }
}

// ---- TOTP 绑定（admin 首次登录引导）：一次性流程 ----
// 内存暂存待确认的 secret（绑定是低频一次性操作，阶段 1 单实例够用，10 分钟过期）。
// startAdminTotpSetup 生成并暂存 → 前端展示 secret + otpauth URI → confirmAdminTotp 校验后加密入库。
const totpSetupStore = new Map<string, { secret: string; expiresAt: number }>()

export async function startAdminTotpSetup(): Promise<{ secret: string; uri: string }> {
  const session = await requireAdmin()
  try {
    const user = await prisma.user.findUnique({ where: { id: session.id } })
    // 调试期 TOTP_BYPASS=true 允许已绑定重新生成 secret（覆盖重绑）；生产仍拒绝
    if (user?.totpEnabled && process.env.TOTP_BYPASS !== 'true') throw new Error('admin 已绑定 TOTP，无需重复绑定')
    const secret = generateSecret()
    totpSetupStore.set(session.id, { secret, expiresAt: Date.now() + 10 * 60 * 1000 })
    return { secret, uri: otpauthURI(secret, session.phone ?? session.id, 'ShopEngine') }
  } catch (e) {
    console.error('生成 admin TOTP 绑定失败:', e)
    throw e
  }
}

export async function confirmAdminTotp(otp: string): Promise<void> {
  const session = await requireAdmin()
  try {
    if (!otp || !/^\d{6}$/.test(otp)) throw new Error('验证码须为 6 位数字')
    const entry = totpSetupStore.get(session.id)
    if (!entry || entry.expiresAt < Date.now()) throw new Error('绑定会话已过期，请重新开始')
    if (!verifyTOTP(entry.secret, otp)) throw new Error('验证码不正确')
    await prisma.user.update({
      where: { id: session.id },
      data: { totpSecret: encryptSecret(entry.secret), totpEnabled: true },
    })
    totpSetupStore.delete(session.id)
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('确认 admin TOTP 绑定失败:', e)
    throw e
  }
}

// 关闭 admin 2FA（设置页开关）：必须用当前验证器验证码确认，防误关/盗关
// 关闭后清空密钥——再次开启走 startAdminTotpSetup 重新绑定新密钥
export async function disableAdminTotp(otp: string): Promise<void> {
  const session = await requireAdmin()
  try {
    const admin = await prisma.user.findUnique({ where: { id: session.id } })
    if (!admin?.totpEnabled || !admin.totpSecret) throw new Error('双重验证未开启')
    // 调试期 TOTP_BYPASS=true：关闭 2FA 免验证码（解开登录/关闭死锁）；生产恢复验证码确认
    if (process.env.TOTP_BYPASS !== 'true') {
      if (!otp || !/^\d{6}$/.test(otp)) throw new Error('验证码须为 6 位数字')
      const secret = decryptSecret(admin.totpSecret)
      if (!verifyTOTP(secret, otp)) throw new Error('验证码不正确')
    }
    await prisma.user.update({
      where: { id: admin.id },
      data: { totpEnabled: false, totpSecret: null },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('关闭 admin 2FA 失败:', e)
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

    revalidatePath('/admin/[locale]/shops', 'page')
  } catch (e) {
    console.error('续费失败（shopId=%s）:', shopId, e)
    throw e
  }
}
