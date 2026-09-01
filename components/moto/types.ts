// MOTO 组件共享类型（与 lib/moto-actions 对齐）
import type { Vehicle } from '@/generated/prisma/client'
import type { Vertical } from '@/lib/vertical'

// 档案序列化类型（server action 返回的 Vehicle，含认领客户可选）
export type VehiclePlain = Vehicle & {
  ownerCustomer?: { id: string; name: string | null } | null
}

// 开单服务项（kind 区分配件/工费；保养参数随单快照）
export type MotoServiceItem = {
  name: string
  qty: number
  price: number
  kind: 'part' | 'labor'
  maintenanceType?: 'OIL' | 'PERIODIC' | 'REPAIR'
  intervalKm?: number | null
  intervalDays?: number | null
}

// 统一 kind 推断（开单 addService 与加单 addMotoItems 共用）：REPAIR→part 配件，其余→labor 工费
// 2026-09-01 P2-AP：消除 quick-order 硬编码 kind:'labor' 与加项推断不一致
export function motoItemKind(maintenanceType?: string): 'part' | 'labor' {
  return maintenanceType === 'REPAIR' ? 'part' : 'labor'
}

// 进度流（与 lib/moto-actions PROGRESS_SEQ 一致，唯一权威见计划 10.6）
export type MotoProgress =
  | 'queued'
  | 'diagnosing'
  | 'quoted'
  | 'repairing'
  | 'waiting_pickup'
  | 'picked_up'

// 本店预设大按钮（来自 Shop.config.presets，seed 已从 MotoPreset 拉取）
export type MotoPresetItem = {
  serviceKey: string
  name: string
  nameZh?: string
  nameEn?: string
  price: string
  unit?: string | null
  category?: string
  maintenanceType?: string
  intervalKm?: number | null
  intervalDays?: number | null
}

// 老板端 shop 序列化（moto-dashboard 用）
export type MotoShop = {
  id: string
  slug: string
  vertical: Vertical
  name: string
  phone: string | null
  currency: string
  /** 城市段（boss 树拼客户 URL 用；一串字符串，工厂兜底 DEFAULT_CITY） */
  city: string
  config: {
    presets?: MotoPresetItem[]
    commonModels?: string[]
    payment?: Record<string, unknown>
  } | null
}
