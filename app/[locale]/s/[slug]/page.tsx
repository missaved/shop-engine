// 客户侧菜单页：/s/[slug]，公开访问（未登录），按 slug 派生租户
import { prisma } from '@/lib/prisma'
import { getShopBySlug, ShopUnavailableError } from '@/lib/tenant'
import { ShopUnavailableView } from '@/components/shop/shop-unavailable'
import { isShopExpired } from '@/lib/billing'
import { MenuOrder } from '@/components/shop/menu-order'
import type { MenuProduct } from '@/components/shop/menu-order'
import { serializeMenuProduct, getRecommendedProducts } from '@/lib/menu'
import { normalizeTheme } from '@/lib/theme'

export default async function ShopMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{
    table?: string | string[]
    type?: string | string[]
    continue?: string | string[]
  }>
}) {
  const { locale, slug } = await params
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
    shop = await getShopBySlug(slug)
  } catch (e) {
    if (e instanceof ShopUnavailableError) {
      return (
        <ShopUnavailableView reason={e.reason} rejectReason={e.rejectReason} />
      )
    }
    throw e
  }

  const products = await prisma.product.findMany({
    where: { shopId: shop.id, active: true },
    orderBy: { sortOrder: 'asc' },
  })

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
      continueOrderNo={continueStr}
    />
  )
}
