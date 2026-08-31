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

// ---- 城市主数据（阶段3 起步：city 从 URL 形态 → 数据维度）----
// 用常量注册表（非 DB 表）当前置：店铺/门户/选择器共用同一城市元数据源，
// 「加城市」只改 CITIES 一项；真正的 City 数据表（时区/币种/邮编等）仍后置。

export interface CityMeta {
  slug: CitySlug
  /** 城市显示名（中文，管理/中文语境）；多语 i18n 城市名后置 */
  name: string
  /** 城市英文名（国际化语境，选择器/门户对国际访客友好） */
  nameEn: string
  /** 国家码（ISO 3166-1 alpha-2，预留多国扩展） */
  country: string
  /** 旗标 emoji */
  flag: string
}

/** 城市元数据表（唯一真源；顺序 = 选择器/门户展示顺序） */
export const CITIES: CityMeta[] = [
  { slug: 'hcm', name: '胡志明市', nameEn: 'Ho Chi Minh City', country: 'VN', flag: '🇻🇳' },
  { slug: 'hn', name: '河内', nameEn: 'Hanoi', country: 'VN', flag: '🇻🇳' },
  { slug: 'dn', name: '岘港', nameEn: 'Da Nang', country: 'VN', flag: '🇻🇳' },
]

/** 表单/选择器下拉选项（value=短码，label=英文名） */
export const CITY_OPTIONS: { value: CitySlug; label: string }[] = CITIES.map((c) => ({
  value: c.slug,
  label: c.nameEn,
}))

/** 短码 → 元数据，未知返回 DEFAULT 的元数据（通用兜底，不做死） */
export function cityMeta(slug: CitySlug): CityMeta {
  return CITIES.find((c) => c.slug === slug) ?? CITIES[0]
}
