// 客户侧单店入口页：/{vertical}/{slug}（公开访问，未登录），按 slug 派生租户
// 多垂直门：vertical 段识别 + 垂直不符→404；非 FOOD 店铺（如 MOTO）落地自己的子页入口
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getShopBySlug, ShopUnavailableError } from '@/lib/tenant'
import { parseVerticalSlug } from '@/lib/vertical'
import { parseCitySlug } from '@/lib/city'
import { shopSubUrl, localizedUrl } from '@/lib/urls'
import type { Locale } from '@/i18n/routing'
import { ShopUnavailableView } from '@/components/shop/shop-unavailable'
import { isShopExpired } from '@/lib/billing'
import { MenuOrder } from '@/components/shop/menu-order'
import type { MenuProduct } from '@/components/shop/menu-order'
import { serializeMenuProduct, getRecommendedProducts } from '@/lib/menu'
import { normalizeTheme } from '@/lib/theme'
import { getTableActiveOrder } from '@/lib/actions'

export default async function ShopMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; city: string; vertical: string; slug: string }>
  searchParams: Promise<{
    table?: string | string[]
    type?: string | string[]
    continue?: string | string[]
  }>
}) {
  const { locale, city: cityParam, vertical: verticalParam, slug } = await params
  // URL 垂直段必须是合法短码，否则 404；getShopBySlug expectVertical 再校验与店实际垂直一致
  const vertical = parseVerticalSlug(verticalParam)
  if (!vertical) notFound()
  // 城市段（58 同城式）：非法短码 → 404；当前 Shop 无 city 字段，city 主要用于 URL 形态/生成链接兜底
  const city = parseCitySlug(cityParam)
  if (!city) notFound()
  // 桌号预填（扫码点餐）：?table= 非字符串（如重复参数成数组）时忽略
  // 继续点菜（track 页「继续点菜」按钮直达菜单）：?type= 恢复用餐方式（堂食/外带/外送），跳过欢迎页重选
  // ?continue= 标记继续点菜目标订单（提交时合并进现有单，不新建单）
  const { table, type, continue: continueParam } = await searchParams
  const tableStr = typeof table === 'string' ? table : ''
  const typeStr = typeof type === 'string' ? type : ''
  const continueStr = typeof continueParam === 'string' ? continueParam : ''
  // 维护模式全拦（含查单）/ 入驻审核未通过店：getShopBySlug 抛 ShopUnavailableError → 渲染提示页
  let shop: Awaited<ReturnType<typeof getShopBySlug>>
  try {
    shop = await getShopBySlug(slug, { expectVertical: vertical })
  } catch (e) {
    if (e instanceof ShopUnavailableError) {
      return (
        <ShopUnavailableView reason={e.reason} rejectReason={e.rejectReason} />
      )
    }
    throw e
  }

  // 非 FOOD 店铺都有自己的落地子页入口（MOTO=store-code 店码落地 /lookup），根路径重定向过去
  if (shop.vertical !== 'FOOD') {
    redirect(
      localizedUrl(shopSubUrl({ vertical: shop.vertical, slug, city }, 'lookup'), locale as Locale),
    )
  }

  const products = await prisma.product.findMany({
    where: { shopId: shop.id, active: true },
    orderBy: { sortOrder: 'asc' },
  })

  // 桌面扫码分流（2026-08-31 堂食桌号锁定）：
  // ① track 页「继续点菜」带 continue 参数 → 直接指向该单，优先；
  // ② 其余扫桌贴码进入（?table=10，无 continue）→ 查该桌进行中单，命中即进加菜模式（只能加菜不能下新单）。
  // 未命中（桌空闲）→ 保持空，正常下新单（开单锁定该桌）。
  let effectiveContinueNo = continueStr
  if (!effectiveContinueNo && tableStr) {
    const tableActive = await getTableActiveOrder({ slug, tableNo: tableStr })
    if (tableActive) effectiveContinueNo = tableActive.orderNo
  }
  // 2026-08-31 已结束订单不得进加菜模式：continue 单若已 COMPLETED/CANCELLED（或不存在），
  // 置空让它退化为正常下新单（不显示「正在向订单加菜」提示）。
  // 根因：track 页「继续点菜」按钮在订单被后台结单后点击（页面未刷新）→ 带出已结束单的 ?continue= 仍进加菜模式。
  if (effectiveContinueNo) {
    const contOrder = await prisma.order.findFirst({
      where: { shopId: shop.id, displayNo: effectiveContinueNo },
      select: { status: true },
    })
    if (!contOrder || contOrder.status === 'COMPLETED' || contOrder.status === 'CANCELLED') {
      effectiveContinueNo = ''
    }
  }

  // 商品 config：三语名/描述 + 图片 URL（有图）/emoji 图标（无图占位）+ canAddOn（出餐后可追加）
  const plain: MenuProduct[] = products.map((p) => serializeMenuProduct(p, locale))

  // 推荐菜（下单成功页「可能你还想吃」）：bestseller 优先，下单成功场景无 orderStatus → 全量
  const recommended = await getRecommendedProducts({ slug, locale })

  const minOrderAmount = Number(
    (shop.config as { minOrderAmount?: number } | null)?.minOrderAmount ?? 0,
  )
  const deliveryFee = Number(
    (shop.config as { deliveryFee?: number } | null)?.deliveryFee ?? 0,
  )
  const packingFee = Number(
    (shop.config as { packingFee?: number } | null)?.packingFee ?? 0,
  )
  const deliveryArea =
    (shop.config as { deliveryArea?: string } | null)?.deliveryArea ?? ''
  // 店面介绍按浏览语种取（2026-08-29 语种混杂修复）：zh/zh-Hant 取 descriptionZh、en 取 descriptionEn，
  // 未填对应语种时回退主 description（默认越南语）；其它语种直接用主 description
  const cfgDesc = shop.config as {
    description?: string
    descriptionZh?: string
    descriptionEn?: string
  } | null
  const shopDesc =
    (locale === 'zh' || locale === 'zh-Hant'
      ? cfgDesc?.descriptionZh
      : locale === 'en'
        ? cfgDesc?.descriptionEn
        : undefined) ||
    cfgDesc?.description ||
    shop.address ||
    ''
  // 店铺门面皮肤（6 套），默认 warm；normalizeTheme 兼容旧值 clean/layered
  const theme = normalizeTheme(
    (shop.config as { theme?: string } | null)?.theme,
  )
  // 营业三态：订阅到期 / 平台停用（老板打烊 open 已有），传给客户菜单渲染
  const expired = await isShopExpired(shop)
  const suspended = shop.platformSuspended
  return (
    <MenuOrder
      vertical={shop.vertical}
      city={city}
      slug={slug}
      shopName={shop.name}
      shopDesc={shopDesc}
      open={shop.open}
      expired={expired}
      suspended={suspended}
      minOrderAmount={minOrderAmount}
      deliveryFee={deliveryFee}
      packingFee={packingFee}
      deliveryArea={deliveryArea}
      theme={theme}
      currency={shop.currency}
      products={plain}
      recommended={recommended}
      initialTableNo={tableStr}
      initialOrderType={typeStr}
      continueOrderNo={effectiveContinueNo}
    />
  )
}
