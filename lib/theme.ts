// 门店皮肤（theme）共享定义
// 皮肤系统：每套皮肤 = 一整套 token（见 app/globals.css 的 .theme-* 变量块），
// 这里只负责「枚举 + 旧值迁移 + i18n key 映射」。
// 约定：新增皮肤 = 加一个 THEMES 项 + globals.css 一个 .theme-* 块 + messages 一个 theme* key。

export const THEMES = [
  'warm', // 暖咖 · 食品暖色（默认）
  'moss', // 墨绿 · 高级餐厅
  'minimal', // 极简 · 杂志风
  'night', // 深夜 · 氛围
  'vibrant', // 活力 · 年轻撞色
  'gourmet', // 高食欲 · 质感（第 6 套）
] as const

export type ShopTheme = (typeof THEMES)[number]

// 旧主题值迁移：clean→minimal，layered→warm（兼容历史数据/引用）
const LEGACY: Record<string, ShopTheme> = {
  clean: 'minimal',
  layered: 'warm',
}

export function normalizeTheme(v?: string | null): ShopTheme {
  if (v && (THEMES as readonly string[]).includes(v)) return v as ShopTheme
  if (v && LEGACY[v]) return LEGACY[v]
  return 'warm'
}

// 皮肤名 → i18n key（settings 段）
export const THEME_LABELS: Record<ShopTheme, string> = {
  warm: 'themeWarm',
  moss: 'themeMoss',
  minimal: 'themeMinimal',
  night: 'themeNight',
  vibrant: 'themeVibrant',
  gourmet: 'themeGourmet',
}
