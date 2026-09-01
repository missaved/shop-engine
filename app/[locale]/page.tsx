import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { Link } from '@/i18n/navigation'
import { verticalUrl } from '@/lib/urls'
import { getVisitorCity } from '@/lib/visitor-city'
import { VERTICALS, type Vertical } from '@/lib/vertical'
import { CitySwitcher } from '@/components/city-switcher'
import { listVerifiedShops } from '@/lib/aggs'

// 聚合页（站点最前面一层）：沉浸大图 Hero + 垂直卡片入口 + 城市/语言切换。
// 2026-09-01 #5 重排：演示店/boss登录已挪进垂直应用（[city]/[vertical]/page.tsx），本页只做「聚合」该做的事。
// 2026-09-01 #6 沉浸大图版：Hero 铺满 hero.jpg（河粉照片）+ 底部渐变 + spotnear 品牌文案；
//   垂直卡片 = 真实图片（本地授权图，见 public/vertical/<slug>.jpg）+ 垂直名 + 店铺数/敬请期待。

// 垂直 → 本地授权卡片图（与 vertical-modules 无耦合；加垂直补一张图 + 注册一项即可）
const VERTICAL_IMG: Record<Vertical, string> = {
  FOOD: '/vertical/food.jpg',
  MOTO: '/vertical/moto.jpg',
  SALON: '/vertical/salon.jpg',
  PET: '/vertical/pet.jpg',
  LAUNDRY: '/vertical/laundry.jpg',
}

// 本页读访客城市(cookie)+查各垂直店数(DB)，保持动态渲染，避免构建期 pre-render 连库。
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const t = await getTranslations('home')
  const ta = await getTranslations('admin')
  // P4-Z：落地页跟随访客最近选择的城市（cookie 记忆，缺省 DEFAULT_CITY）
  const city = await getVisitorCity()

  // 各垂直已入驻店铺数（并行查询；「敬请期待」= 0）
  const counts = await Promise.all(
    VERTICALS.map(async (v) => (await listVerifiedShops(v, city)).length),
  )

  return (
    <main className="flex flex-1 flex-col">
      {/* 沉浸大图 Hero：贴顶铺满 */}
      <section className="relative flex h-[220px] flex-col justify-end overflow-hidden px-5 pb-14 pt-5">
        {/* 背景照片 */}
        <div
          className="absolute inset-0 bg-cover bg-[center_58%]"
          style={{ backgroundImage: "url('/hero/hero.jpg')" }}
        />
        {/* 底部压暗渐变：给文字留可读区 */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />

        {/* 顶部：城市 + 语言切换（半透明 pill） */}
        <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-full bg-white/12 px-3 py-1.5 backdrop-blur-md">
            <span className="text-sm leading-none">📍</span>
            <CitySwitcher className="border-0 bg-transparent pr-0 text-[12.5px] font-medium text-white outline-none [&>option]:text-zinc-900" />
          </div>
          <div className="flex items-center rounded-full bg-white/12 px-1.5 py-1 backdrop-blur-md">
            <LocaleSwitcher />
          </div>
        </div>

        {/* 底部：品牌 + 主标题 + 副标题 + tagline */}
        <div className="relative z-10 flex flex-col">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/75">
            spotnear · nearby life
          </span>
          <h1 className="mt-1 text-[27px] font-extrabold leading-[1.1] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]">
            {t('title')}
          </h1>
          <p className="mt-1.5 max-w-[82%] text-[13px] leading-snug text-white/90">
            {t('subtitle')}
          </p>
          <p className="mt-0.5 text-[11.5px] text-white/70">{t('tagline')}</p>
        </div>
      </section>

      {/* 垂直卡片入口：2×2 网格，顶部真实场景图 */}
      <section className="rounded-t-[26px] bg-[#181820] px-5 pb-8 pt-6">
        <h2 className="mb-3 text-[12px] font-bold uppercase tracking-[0.06em] text-zinc-500">
          {t('chooseService')}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {VERTICALS.map((v, i) => {
            const key = 'vertical' + v[0] + v.slice(1).toLowerCase()
            const count = counts[i]
            return (
              <Link
                key={v}
                href={verticalUrl(v, city)}
                className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#22222b] transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20"
              >
                <span
                  className="relative h-24 bg-cover bg-center"
                  style={{ backgroundImage: `url('${VERTICAL_IMG[v]}')` }}
                >
                  <span className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                </span>
                <span className="relative flex flex-col p-3">
                  <span className="text-[14.5px] font-bold text-white">{ta(key)}</span>
                  <span className="mt-0.5 flex items-baseline justify-between">
                    <span
                      className={
                        count > 0
                          ? 'text-[11.5px] font-semibold text-amber-400'
                          : 'text-[11.5px] text-zinc-500'
                      }
                    >
                      {count > 0 ? t('verticalCount', { n: count }) : ta('comingSoon')}
                    </span>
                    <span className="text-xs text-zinc-500 transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      </section>
    </main>
  )
}
