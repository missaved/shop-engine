// 城市中央注册表：唯一真源。纯常量/纯函数，叶子模块（零 app 业务逻辑导入，防循环依赖）。
// 「加城市」= 在 CITY_SLUG 加一项，其余代码零改。城市是「水平」维度，独立于垂直(Vertical)。
// 当前 Shop 无 city 字段，city 段先作为 URL 形态地基（DEFAULT_CITY 撑起）；
// 阶段3 加城市主数据/Shop.city 后，聚合/单店再按 city 过滤。届时城市集仅扩数组、核心零改。
export const CITY_SLUG = {
  HCM: 'hcm', // 胡志明市
  HN: 'hn', // 河内
  DN: 'dn', // 岘港
} as const

export type CitySlug = (typeof CITY_SLUG)[keyof typeof CITY_SLUG]

/** 缺省城市（无城市主数据时，URL 段/生成链接的兜底城市） */
export const DEFAULT_CITY: CitySlug = 'hcm'

/** 短码 → 城市，未知返回 null（通用兜底，不做死） */
export function parseCitySlug(s: string): CitySlug | null {
  return (Object.values(CITY_SLUG) as CitySlug[]).includes(s as CitySlug)
    ? (s as CitySlug)
    : null
}

/** 某字符串是否合法城市短码（URL 路由层面用） */
export function isCitySlug(s: string): s is CitySlug {
  return parseCitySlug(s) !== null
}
