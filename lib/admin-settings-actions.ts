// 中台设置中心 server actions（2026-08-29 设置中心扩展）
// 授权：全部 requireAdmin()。写入均合并式（未传字段不覆盖），敏感字段（*Key/*Secret/*Password 结尾）AES 加密落库。
// 审计：关键操作写 AuditLog（writeAudit 内部 try-catch，失败不阻塞主操作）。
// 安全：任何读取接口不返回敏感明文（只回「已配置」布尔 + 非敏感字段）。
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/dal'
import { createHash, randomBytes } from 'node:crypto'
import { getSetting, setSetting, encryptSensitiveValues } from '@/lib/platform-settings'
import { writeAudit, AUDIT_ACTION, AUDIT_TARGET } from '@/lib/audit'

// ---- 合并式保存辅助：去掉 undefined/空串字段（留空 = 不修改），敏感字段加密 ----

function pruneEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '') continue // 未填/留空 → 跳过，保留原值
    out[k] = v
  }
  return out as Partial<T>
}

async function mergeSet(key: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cur = (await getSetting<Record<string, unknown>>(key)) ?? {}
  const next = { ...cur, ...pruneEmpty(input) }
  // 敏感字段（*Key/*Secret/*Password 结尾）加密后落库；空值已在 pruneEmpty 剔除
  await setSetting(key, encryptSensitiveValues(next))
  return next
}

// ---- 设置页读取（脱敏：不返回敏感明文）----

export type SettingsData = {
  site: Record<string, unknown> | null
  ai: {
    minimaxModel?: string
    minimaxKeyConfigured: boolean
    deepseekModel?: string
    deepseekKeyConfigured: boolean
    geminiModel?: string
    geminiKeyConfigured: boolean
  }
  oauth: {
    google: { enabled?: boolean; clientId?: string; clientSecretConfigured: boolean }
    facebook: { enabled?: boolean; clientId?: string; clientSecretConfigured: boolean }
    zalo: { enabled?: boolean; clientId?: string; clientSecretConfigured: boolean }
  } | null
  security: Record<string, unknown> | null
  maintenance: Record<string, unknown> | null
  notification: {
    smtp: { enabled?: boolean; host?: string; port?: number; user?: string; from?: string; passwordConfigured: boolean }
    sms: { enabled?: boolean; provider?: string; from?: string; apiKeyConfigured: boolean }
  } | null
  onboarding: Record<string, unknown> | null
  billing: Record<string, unknown> | null
  totpBypass: boolean
  tiers: { key: string; name: string; price: string; months: number; shopLimit: number | null; productLimit: number | null; aiQuota: number | null; active: boolean; sortOrder: number }[]
  announcements: { id: string; title: string; body: string; locale: string | null; startsAt: Date | null; endsAt: Date | null; active: boolean }[]
  apiKeys: { id: string; name: string; scope: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }[]
}

export async function getSettingsData(): Promise<SettingsData> {
  await requireAdmin()
  const [site, aiRaw, oauthRaw, security, maintenance, notifRaw, onboarding, billing, tiers, announcements, apiKeys] =
    await Promise.all([
      getSetting<Record<string, unknown>>('site'),
      getSetting<Record<string, unknown>>('ai'),
      getSetting<Record<string, unknown>>('oauth'),
      getSetting<Record<string, unknown>>('security'),
      getSetting<Record<string, unknown>>('maintenance'),
      getSetting<Record<string, unknown>>('notification'),
      getSetting<Record<string, unknown>>('onboarding'),
      getSetting<Record<string, unknown>>('billing'),
      prisma.planTier.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.platformAnnouncement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    ])

  const oauth = oauthRaw
    ? {
        google: providerView(oauthRaw['google']),
        facebook: providerView(oauthRaw['facebook']),
        zalo: providerView(oauthRaw['zalo']),
      }
    : null

  // 通知配置脱敏：SMTP/SMS 的 password/apiKey 加密落库，读取只回「已配置」布尔（2026-08-29 安全约束）
  const notifSmtp = (notifRaw?.['smtp'] ?? {}) as Record<string, unknown>
  const notifSms = (notifRaw?.['sms'] ?? {}) as Record<string, unknown>
  const notification = notifRaw
    ? {
        smtp: {
          enabled: notifSmtp['enabled'] as boolean | undefined,
          host: notifSmtp['host'] as string | undefined,
          port: notifSmtp['port'] as number | undefined,
          user: notifSmtp['user'] as string | undefined,
          from: notifSmtp['from'] as string | undefined,
          passwordConfigured: !!notifSmtp['password'],
        },
        sms: {
          enabled: notifSms['enabled'] as boolean | undefined,
          provider: notifSms['provider'] as string | undefined,
          from: notifSms['from'] as string | undefined,
          apiKeyConfigured: !!notifSms['apiKey'],
        },
      }
    : null

  return {
    site,
    ai: {
      minimaxModel: (aiRaw?.['minimaxModel'] as string) ?? '',
      minimaxKeyConfigured: !!aiRaw?.['minimaxKey'],
      deepseekModel: (aiRaw?.['deepseekModel'] as string) ?? '',
      deepseekKeyConfigured: !!aiRaw?.['deepseekKey'],
      geminiModel: (aiRaw?.['geminiModel'] as string) ?? '',
      geminiKeyConfigured: !!aiRaw?.['geminiKey'],
    },
    oauth,
    security,
    maintenance,
    notification,
    onboarding,
    billing,
    totpBypass: process.env.TOTP_BYPASS === 'true',
    tiers: tiers.map((t) => ({
      key: t.key,
      name: t.name,
      price: t.price.toString(),
      months: t.months,
      shopLimit: t.shopLimit,
      productLimit: t.productLimit,
      aiQuota: t.aiQuota,
      active: t.active,
      sortOrder: t.sortOrder,
    })),
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      locale: a.locale,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      active: a.active,
    })),
    apiKeys: apiKeys.map((k) => ({
      id: k.id,
      name: k.name,
      scope: k.scope,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    })),
  }
}

function providerView(v: unknown): {
  enabled?: boolean
  clientId?: string
  clientSecretConfigured: boolean
} {
  const p = (v ?? {}) as Record<string, unknown>
  return {
    enabled: p['enabled'] as boolean | undefined,
    clientId: p['clientId'] as string | undefined,
    clientSecretConfigured: !!p['clientSecret'],
  }
}

// ---- 配置保存（每块独立 action）----

export async function saveSiteSettings(input: {
  name?: string
  logoUrl?: string
  timezone?: string
  currency?: string
  defaultLocale?: string
}) {
  const admin = await requireAdmin()
  try {
    await mergeSet('site', input)
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.CONFIG_CHANGE,
      targetType: AUDIT_TARGET.SETTING,
      targetId: 'site',
      detail: { keys: Object.keys(pruneEmpty(input)) },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('saveSiteSettings:', e)
    throw e
  }
}

export async function saveAiConfig(input: {
  minimaxKey?: string
  minimaxModel?: string
  deepseekKey?: string
  deepseekModel?: string
  geminiKey?: string
  geminiModel?: string
}) {
  const admin = await requireAdmin()
  try {
    await mergeSet('ai', input)
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.CONFIG_CHANGE,
      targetType: AUDIT_TARGET.SETTING,
      targetId: 'ai',
      detail: { keys: Object.keys(pruneEmpty(input)) },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('saveAiConfig:', e)
    throw e
  }
}

export async function saveOauthConfig(input: {
  provider: 'google' | 'facebook' | 'zalo'
  enabled?: boolean
  clientId?: string
  clientSecret?: string
}) {
  const admin = await requireAdmin()
  try {
    const cur = (await getSetting<Record<string, Record<string, unknown>>>('oauth')) ?? {}
    const p = (cur[input.provider] ?? {}) as Record<string, unknown>
    // enabled 是布尔（false 也算「填了」），不能走 pruneEmpty（会丢掉 false）
    const nextProvider: Record<string, unknown> = { ...p }
    if (input.enabled !== undefined) nextProvider['enabled'] = input.enabled
    if (input.clientId) nextProvider['clientId'] = input.clientId
    if (input.clientSecret) nextProvider['clientSecret'] = input.clientSecret // 加密在 mergeSet 内
    const next = { ...cur, [input.provider]: nextProvider }
    await setSetting('oauth', encryptSensitiveValues(next))
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.CONFIG_CHANGE,
      targetType: AUDIT_TARGET.SETTING,
      targetId: 'oauth',
      detail: { provider: input.provider },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('saveOauthConfig:', e)
    throw e
  }
}

export async function saveSecuritySettings(input: {
  totpForce?: boolean
  rateLimitMax?: number
  rateLimitWindowMin?: number
  accountLockThreshold?: number
  accountLockMinutes?: number
}) {
  const admin = await requireAdmin()
  try {
    await mergeSet('security', input)
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.CONFIG_CHANGE,
      targetType: AUDIT_TARGET.SETTING,
      targetId: 'security',
      detail: { keys: Object.keys(pruneEmpty(input)) },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('saveSecuritySettings:', e)
    throw e
  }
}

export async function saveMaintenanceSettings(input: { mode?: boolean; message?: string }) {
  const admin = await requireAdmin()
  try {
    await mergeSet('maintenance', input)
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.CONFIG_CHANGE,
      targetType: AUDIT_TARGET.SETTING,
      targetId: 'maintenance',
      detail: { keys: Object.keys(pruneEmpty(input)) },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('saveMaintenanceSettings:', e)
    throw e
  }
}

export async function saveNotificationSettings(input: {
  smtpEnabled?: boolean
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPassword?: string
  smtpFrom?: string
  smsEnabled?: boolean
  smsProvider?: string
  smsApiKey?: string
  smsFrom?: string
}) {
  const admin = await requireAdmin()
  try {
    const cur = (await getSetting<Record<string, unknown>>('notification')) ?? {}
    // 拆成 smtp / sms 两组再合并（敏感字段分组加密）
    const smtp = (cur['smtp'] ?? {}) as Record<string, unknown>
    const sms = (cur['sms'] ?? {}) as Record<string, unknown>
    if (input.smtpEnabled !== undefined) smtp['enabled'] = input.smtpEnabled
    if (input.smtpHost) smtp['host'] = input.smtpHost
    if (input.smtpPort !== undefined) smtp['port'] = input.smtpPort
    if (input.smtpUser) smtp['user'] = input.smtpUser
    if (input.smtpPassword) smtp['password'] = input.smtpPassword
    if (input.smtpFrom) smtp['from'] = input.smtpFrom
    if (input.smsEnabled !== undefined) sms['enabled'] = input.smsEnabled
    if (input.smsProvider) sms['provider'] = input.smsProvider
    if (input.smsApiKey) sms['apiKey'] = input.smsApiKey
    if (input.smsFrom) sms['from'] = input.smsFrom
    const next = { ...cur, smtp, sms }
    await setSetting('notification', encryptSensitiveValues(next))
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.CONFIG_CHANGE,
      targetType: AUDIT_TARGET.SETTING,
      targetId: 'notification',
      detail: { keys: Object.keys(pruneEmpty(input)) },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('saveNotificationSettings:', e)
    throw e
  }
}

export async function saveOnboardingSettings(input: { reviewRequired?: boolean }) {
  const admin = await requireAdmin()
  try {
    await mergeSet('onboarding', input)
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.CONFIG_CHANGE,
      targetType: AUDIT_TARGET.SETTING,
      targetId: 'onboarding',
      detail: { keys: Object.keys(pruneEmpty(input)) },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('saveOnboardingSettings:', e)
    throw e
  }
}

export async function saveBillingSettings(input: { trialDays?: number; expiryPolicy?: string; graceDays?: number }) {
  const admin = await requireAdmin()
  try {
    await mergeSet('billing', input)
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.CONFIG_CHANGE,
      targetType: AUDIT_TARGET.SETTING,
      targetId: 'billing',
      detail: { keys: Object.keys(pruneEmpty(input)) },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('saveBillingSettings:', e)
    throw e
  }
}

// ---- PlanTier 套餐档位 CRUD ----

export async function listTiers() {
  await requireAdmin()
  return prisma.planTier.findMany({ orderBy: { sortOrder: 'asc' } })
}

export async function saveTier(input: {
  key: string
  name: string
  price: number
  months: number
  shopLimit?: number | null
  productLimit?: number | null
  aiQuota?: number | null
  active?: boolean
}) {
  const admin = await requireAdmin()
  try {
    const key = input.key.trim().toUpperCase()
    if (!/^[A-Z0-9_-]+$/.test(key)) throw new Error('套餐 key 只能含大写字母、数字、下划线、连字符')
    if (!input.name.trim()) throw new Error('套餐名称不能为空')
    if (!Number.isInteger(input.months) || input.months <= 0) throw new Error('套餐月数须为正整数')
    if (!Number.isFinite(input.price) || input.price < 0) throw new Error('价格无效')
    await prisma.planTier.upsert({
      where: { key },
      update: {
        name: input.name.trim(),
        price: input.price,
        months: input.months,
        shopLimit: input.shopLimit ?? null,
        productLimit: input.productLimit ?? null,
        aiQuota: input.aiQuota ?? null,
        // 编辑时不传 active 即保留原值（修复：原 `?? true` 会静默激活非激活档；新增默认 true 走 create 分支）
      },
      create: {
        key,
        name: input.name.trim(),
        price: input.price,
        months: input.months,
        shopLimit: input.shopLimit ?? null,
        productLimit: input.productLimit ?? null,
        aiQuota: input.aiQuota ?? null,
        active: input.active ?? true,
        sortOrder: 99,
      },
    })
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.PLAN,
      targetType: AUDIT_TARGET.PLAN,
      targetId: key,
      detail: { name: input.name.trim(), price: input.price, months: input.months },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('saveTier:', e)
    throw e
  }
}

export async function deleteTier(key: string) {
  const admin = await requireAdmin()
  try {
    if (key === 'TRIAL') throw new Error('TRIAL 为基础档位，不可删除')
    const used = await prisma.shop.count({ where: { plan: key } })
    if (used > 0) throw new Error(`已有 ${used} 家店铺使用该套餐，不可删除`)
    await prisma.planTier.delete({ where: { key } })
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.PLAN,
      targetType: AUDIT_TARGET.PLAN,
      targetId: key,
      detail: { deleted: true },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('deleteTier:', e)
    throw e
  }
}

// ---- 平台公告 CRUD ----

export async function listAnnouncements() {
  await requireAdmin()
  return prisma.platformAnnouncement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
}

export async function saveAnnouncement(input: {
  id?: string
  title: string
  body: string
  locale?: string | null
  startsAt?: string | null
  endsAt?: string | null
  active?: boolean
}) {
  const admin = await requireAdmin()
  try {
    if (!input.title.trim() || !input.body.trim()) throw new Error('公告标题与正文不能为空')
    const data = {
      title: input.title.trim(),
      body: input.body.trim(),
      locale: input.locale || null,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      active: input.active ?? true,
    }
    if (input.id) {
      await prisma.platformAnnouncement.update({ where: { id: input.id }, data })
    } else {
      await prisma.platformAnnouncement.create({ data })
    }
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.ANNOUNCEMENT,
      targetType: AUDIT_TARGET.ANNOUNCEMENT,
      targetId: input.id ?? 'new',
      detail: { title: input.title.trim() },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('saveAnnouncement:', e)
    throw e
  }
}

export async function deleteAnnouncement(id: string) {
  const admin = await requireAdmin()
  try {
    await prisma.platformAnnouncement.delete({ where: { id } })
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.ANNOUNCEMENT,
      targetType: AUDIT_TARGET.ANNOUNCEMENT,
      targetId: id,
      detail: { deleted: true },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('deleteAnnouncement:', e)
    throw e
  }
}

// ---- 平台 API key（明文仅创建时显示一次）----

export async function listApiKeys() {
  await requireAdmin()
  return prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
}

export async function createApiKey(name: string): Promise<{ id: string; name: string; plain: string }> {
  const admin = await requireAdmin()
  try {
    if (!name.trim()) throw new Error('key 名称不能为空')
    const plain = `api_${randomBytes(24).toString('hex')}`
    const keyHash = createHash('sha256').update(plain).digest('hex')
    const created = await prisma.apiKey.create({ data: { name: name.trim(), keyHash } })
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.APIKEY,
      targetType: AUDIT_TARGET.APIKEY,
      targetId: created.id,
      detail: { name: name.trim() },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
    return { id: created.id, name: created.name, plain } // 明文仅此一次返回
  } catch (e) {
    console.error('createApiKey:', e)
    throw e
  }
}

export async function revokeApiKey(id: string) {
  const admin = await requireAdmin()
  try {
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } })
    await writeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: AUDIT_ACTION.APIKEY,
      targetType: AUDIT_TARGET.APIKEY,
      targetId: id,
      detail: { revoked: true },
    })
    revalidatePath('/admin/[locale]/settings', 'page')
  } catch (e) {
    console.error('revokeApiKey:', e)
    throw e
  }
}

// ---- 审计日志查询 ----

export async function listAuditLogs(
  page = 1,
  filters?: { action?: string; targetType?: string },
) {
  await requireAdmin()
  const pageSize = 30
  const where = {
    ...(filters?.action ? { action: filters.action } : {}),
    ...(filters?.targetType ? { targetType: filters.targetType } : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ])
  return { rows, total, page, pageSize }
}
