'use server'
// 公开自助开店申请（2026-09-01 #4）：游客在前台提交「店名+垂直+城市+老板手机+密码」→ 建待审 Shop + 老板账号。
// 与 admin 的 createShop 分离：不 requireAdmin、无内部审计、加 IP 限流防刷库；复用同一套入驻审核开关（approved 取决于 onboarding.reviewRequired）。
// 设计取舍（用户拍板「基础四字段」）：单店 slug 由店名自动生成（冲突加随机后缀），currency/plan/trialDays/营业时间/地址等系统默认或后台补，
//   申请表只收用户确认的四字段。slug 防撞用 RESERVED_SHOP_SLUGS + 格式校验（与 createShop 同一套卫生保留字）。
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { hash } from 'bcryptjs'
import { isRateLimited, recordFailure } from '@/lib/rate-limit'
import { validateOwnerPassword } from '@/lib/password-policy'
import { RESERVED_SHOP_SLUGS, VERTICALS, type Vertical } from './vertical'
import { type CitySlug, DEFAULT_CITY, isCitySlug } from './city'
import { getSetting } from '@/lib/platform-settings'

export interface OpenShopInput {
  name: string
  vertical: Vertical
  city?: string
  ownerPhone: string
  ownerPassword: string
}

// 店名 → slug：取小写字母/数字/连字符；全非 ASCII（如纯中文店名）用 shop- 前缀 + 时间戳兜底
function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return base || `shop-${Date.now().toString(36).slice(-6)}`
}

export async function openShopApplication(
  input: OpenShopInput,
): Promise<{ approved: boolean }> {
  // 防刷库：按 IP 限流（open-shop 前缀隔离，不与 owner/track 共用计数）
  const h = await headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip')?.trim() ||
    'unknown'
  const key = `open-shop:${ip}`
  if (isRateLimited(key)) throw new Error('提交过于频繁，请稍后再试')

  try {
    const name = input.name?.trim()
    const vertical = input.vertical
    const city = (input.city ?? DEFAULT_CITY) as CitySlug
    const ownerPhone = input.ownerPhone?.trim()
    const ownerPassword = input.ownerPassword ?? ''

    if (!name) throw new Error('店名不能为空')
    if (!VERTICALS.includes(vertical)) throw new Error('未知垂直类目')
    if (!isCitySlug(city)) throw new Error('未知城市短码')
    if (!ownerPhone) throw new Error('老板手机号不能为空')
    const pwdErr = validateOwnerPassword(ownerPassword)
    if (pwdErr) throw new Error('老板初始密码至少 8 位')

    // slug 自动生成 + 唯一化（保留字/格式非法或已占用 → 加随机后缀重试）
    const base = slugifyName(name)
    const invalid = (s: string) =>
      RESERVED_SHOP_SLUGS.has(s) || !/^[a-z0-9]{3,30}$/.test(s)
    const collide = async (s: string) =>
      invalid(s) || !!(await prisma.shop.findUnique({ where: { slug: s } }))
    let slug = base
    for (let i = 0; i < 5; i++) {
      if (!(await collide(slug))) break
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
    }

    // 老板手机号唯一（P2002 兜底）
    const phoneTaken = await prisma.user.findUnique({ where: { phone: ownerPhone } })
    if (phoneTaken) throw new Error('该老板手机号已注册，请直接登录')

    // 入驻审核联动（与 createShop 同一开关）：reviewRequired=true → 待审，后台通过后才上线；关闭 → 直接开店
    const onboarding = await getSetting<{ reviewRequired?: boolean }>('onboarding')
    const approved = !(onboarding?.reviewRequired)

    // 试用期：平台默认 billing.trialDays；0/缺省 → 30 天
    const billingTrial = (await getSetting<{ trialDays?: number }>('billing'))?.trialDays
    const effTrialDays = billingTrial ?? 30
    const subscribedUntil =
      effTrialDays > 0 ? new Date(Date.now() + effTrialDays * 24 * 60 * 60 * 1000) : null

    await prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          slug,
          name,
          vertical,
          city,
          currency: 'VND',
          plan: 'TRIAL',
          approved,
          subscribedUntil,
          config: {},
        },
      })
      await tx.user.create({
        data: {
          shopId: shop.id,
          phone: ownerPhone,
          passwordHash: await hash(ownerPassword, 10),
          name: '老板',
          role: 'OWNER',
        },
      })
    })

    // 让 admin 后台店铺列表立刻看到新申请
    revalidatePath('/admin/[locale]/shops', 'page')
    return { approved }
  } catch (e) {
    // 真实业务抛错（含 P2002 唯一冲突兜底）记一次失败，供后续限流
    recordFailure(key)
    throw e
  }
}
