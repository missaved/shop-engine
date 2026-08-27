// 路由语言配置（next-intl）
import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  // defaultLocale 用 en：根路径 / 与默认跳转落英文（越南店主浏览器 Accept-Language 会自动跳 /vi）
  // 6 语言：简体 / 繁体 / 英文 / 越南 / 马来 / 泰文（加语言只改这里 + 加 messages/<locale>.json）
  locales: ['zh', 'zh-Hant', 'en', 'vi', 'ms', 'th'],
  defaultLocale: 'en',
})

export type Locale = (typeof routing.locales)[number]
