// 垂直中央注册表：唯一真源。纯常量/纯函数，零 app 业务逻辑导入（防循环依赖，叶子模块）。
// 「加垂直」= 在这里加一项 + 差异化逻辑进 lib/vertical-modules.ts，其余代码零改。
// Vertical 类型统一取自 prisma 生成 client（@/generated/prisma/client = schema.prisma 的 enum Vertical），
// 仅 `import type`（编译期擦除，不把 node/prisma runtime 带进 client 组件）。
import type { Vertical } from '@/generated/prisma/client'

export type { Vertical }

/** 全垂直数组（保留形态，供下拉/过滤/校验用） */
export const VERTICALS: Vertical[] = ['FOOD', 'MOTO', 'SALON', 'PET', 'LAUNDRY']

/** 垂直 → URL 短码。短码必须全小写、不与 locales 及 depth-1 静态段重合（见 plans 审计 §0/D4） */
export const VERTICAL_SLUG = {
  FOOD: 'food',
  MOTO: 'moto',
  SALON: 'salon',
  PET: 'pet',
  LAUNDRY: 'laundry',
} as const satisfies Record<Vertical, string>

export type VerticalSlug = (typeof VERTICAL_SLUG)[keyof typeof VERTICAL_SLUG]

/** 垂直 → 短码（结构性恒成立） */
export function verticalSlug(v: Vertical): VerticalSlug {
  return VERTICAL_SLUG[v]
}

/** 短码 → 垂直，未知返回 null（通用兜底，不做死） */
export function parseVerticalSlug(s: string): Vertical | null {
  const hit = (Object.entries(VERTICAL_SLUG) as [Vertical, VerticalSlug][]).find(
    ([, slug]) => slug === s,
  )
  return hit ? hit[0] : null
}

/** 某字符串是否合法垂直短码（URL 路由层面用） */
export function isVerticalSlug(s: string): s is VerticalSlug {
  return parseVerticalSlug(s) !== null
}

// 店 slug 保留字：单点定义（原 admin-actions.ts / add-shop-form.tsx 各一份，受旧 /s 架构污染：含已删除的 s、缺垂直短码）。
// 与 URL 段位同名/同义的词，防店 slug 造成语义混淆（店 slug 落 [vertical]/[slug] depth-2，无硬性路由冲突，此为卫生保留）。
// 垂直短码从 VERTICAL_SLUG 派生；locale/静态段/子路径为固定清单（不 import routing，保持叶子模块纯）。
export const RESERVED_SHOP_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'login',
  'dashboard',
  'api',
  'manifest',
  'sw',
  'zh',
  'zh-hant',
  'en',
  'vi',
  'ms',
  'th',
  ...Object.values(VERTICAL_SLUG),
  'lookup',
  'track',
])
