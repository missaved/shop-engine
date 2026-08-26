// 路由语言配置（next-intl）
import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  // 目标市场越南店老板为主，defaultLocale 用 vi；开发/后台可切 zh
  locales: ['zh', 'en', 'vi'],
  defaultLocale: 'vi',
})

export type Locale = (typeof routing.locales)[number]
