'use server'
// M4.4 admin 中台 moto 预设库（MotoPreset 独立表：一服务一行，三语名/默认价/间隔参数）
// 仿 preset-actions 的 food 管理位，但 moto 表结构与 FoodPreset 不同（food 是子分类含 items，moto 是一服务一行）
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/dal'

export type AdminMotoPreset = {
  id: string
  serviceKey: string
  nameVi: string
  nameZh: string
  nameEn: string
  defaultPrice: string
  unit: string | null
  category: string
  maintenanceType: string
  intervalKm: number | null
  intervalDays: number | null
  active: boolean
  sortOrder: number
}

export async function listMotoPresets(): Promise<AdminMotoPreset[]> {
  await requireAdmin()
  const rows = await prisma.motoPreset.findMany({
    orderBy: [{ sortOrder: 'asc' }, { serviceKey: 'asc' }],
  })
  return rows.map((r) => ({ ...r, defaultPrice: r.defaultPrice.toString() }))
}

type SaveInput = {
  id?: string
  serviceKey: string
  nameVi: string
  nameZh: string
  nameEn: string
  defaultPrice: number
  unit?: string | null
  category: string
  maintenanceType: string
  intervalKm?: number | null
  intervalDays?: number | null
  active: boolean
  sortOrder?: number
}

export async function saveMotoPreset(
  input: SaveInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin()
    const data = {
      serviceKey: input.serviceKey.trim(),
      nameVi: input.nameVi.trim(),
      nameZh: input.nameZh.trim(),
      nameEn: input.nameEn.trim(),
      defaultPrice: Math.max(0, Math.round(input.defaultPrice)),
      unit: input.unit?.trim() || null,
      category: input.category,
      maintenanceType: input.maintenanceType,
      intervalKm: input.intervalKm ?? null,
      intervalDays: input.intervalDays ?? null,
      active: input.active,
      sortOrder: input.sortOrder ?? 0,
    }
    if (input.id) {
      await prisma.motoPreset.update({ where: { id: input.id }, data })
    } else {
      await prisma.motoPreset.create({ data })
    }
    revalidatePath('/admin/[locale]/moto-presets', 'page')
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    const duplicate = msg.includes('Unique') || msg.includes('serviceKey')
    return { ok: false, error: duplicate ? 'serviceKey 已存在' : msg }
  }
}

export async function toggleMotoPresetActive(id: string): Promise<{ ok: boolean }> {
  try {
    await requireAdmin()
    const row = await prisma.motoPreset.findUnique({ where: { id } })
    if (row) {
      await prisma.motoPreset.update({ where: { id }, data: { active: !row.active } })
    }
    revalidatePath('/admin/[locale]/moto-presets', 'page')
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
