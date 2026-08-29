// 平台审计日志（2026-08-29 设置中心扩展）：writeAudit 助手。
// 写入失败不阻塞主操作（try-catch + console.error）；action/targetType 用常量防拼写漂移。
import { prisma } from '@/lib/prisma'

export const AUDIT_ACTION = {
  LOGIN: 'login',
  SHOP_MANAGE: 'shop_manage', // 建店/停用/推荐/删除/授权/审核
  BILL: 'bill', // 续费/套餐变更
  CONFIG_CHANGE: 'config_change', // 平台设置修改
  TOTP: 'totp', // 2FA 绑定/重设/关闭
  PLAN: 'plan', // 套餐档位 CRUD
  ANNOUNCEMENT: 'announcement',
  APIKEY: 'apikey',
  AUTH: 'auth', // 改密/解锁/封禁
  RESET_PWD: 'reset_pwd',
} as const

export const AUDIT_TARGET = {
  SHOP: 'shop',
  USER: 'user',
  PLAN: 'plan',
  SETTING: 'setting',
  ANNOUNCEMENT: 'announcement',
  APIKEY: 'apikey',
} as const

export type AuditEntry = {
  actorId?: string | null
  actorName?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  detail?: unknown
  ip?: string | null
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        detail: (entry.detail as object) ?? undefined,
        ip: entry.ip ?? null,
      },
    })
  } catch (e) {
    console.error('审计写入失败（不阻塞主操作）:', e)
  }
}
