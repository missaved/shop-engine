'use client'
// 城市切换器：替换 URL 的 city 段，保持 locale + 后续 vertical/slug 段。
// 独立于垂直（水平维度），落地/门户/聚合/单店任何页可放。
// 用整页跳转（window.location.href）——城市切换是低频导航，避免依赖 next-intl router 的路径重写坑。
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CITIES, type CitySlug, isCitySlug } from '@/lib/city'

export function CitySwitcher({ className }: { className?: string }) {
  const pathname = usePathname() // /en/hcm/food/demo-pho（含 locale）
  const t = useTranslations('city')
  const segs = pathname.split('/')
  const current =
    segs.length >= 3 && isCitySlug(segs[2]) ? (segs[2] as CitySlug) : undefined

  function go(next: CitySlug) {
    // 记忆最近城市（供落地页等无 city 段页读 cookie 做缺省；不改跳转语义，仍按路径段/插入切城）
    document.cookie = `spotnear.city=${next}; max-age=31536000; path=/; SameSite=Lax`
    const s = pathname.split('/')
    if (s.length >= 3 && isCitySlug(s[2])) {
      s[2] = next
    } else {
      // 无 city 段（如 /en 落地页）：在 locale 后插入
      s.splice(2, 0, next)
    }
    window.location.href = s.join('/')
  }

  return (
    <select
      value={current ?? CITIES[0].slug}
      onChange={(e) => go(e.target.value as CitySlug)}
      aria-label="city"
      className={
        className ??
        'rounded-md border border-zinc-300 px-2 py-1 font-normal text-sm dark:border-zinc-700 dark:bg-zinc-800'
      }
    >
      {CITIES.map((c) => (
        <option key={c.slug} value={c.slug}>
          {t(c.slug)}
        </option>
      ))}
    </select>
  )
}
