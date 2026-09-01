// 访客城市 helper：读「最近选择城市」cookie，供无 city 段页（如落地页）做缺省。
// city.ts 是纯层（零 app 依赖，不可被 next/headers 污染），读 cookie 需 server 上下文，
// 故独立此 server-only 模块（引纯层的 isCitySlug/DEFAULT_CITY，service 引纯层合法无环）。
// 与 URL 段的 city 区别：URL 段是「当前上下文」，此 cookie 是「记忆偏好」（跨页保留）。
import 'server-only'
import { cookies } from 'next/headers'
import { DEFAULT_CITY, isCitySlug, type CitySlug } from '@/lib/city'

const CITY_COOKIE = 'spotnear.city'

// 访客最近选择的城市；无 cookie / 非法值 → DEFAULT_CITY（通用兜底，不做死）
export async function getVisitorCity(): Promise<CitySlug> {
  const c = (await cookies()).get(CITY_COOKIE)?.value
  return c && isCitySlug(c) ? c : DEFAULT_CITY
}
