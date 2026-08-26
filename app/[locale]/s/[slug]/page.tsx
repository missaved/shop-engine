// 客户侧菜单页：/s/[slug]，公开访问（未登录），按 slug 派生租户
import { prisma } from '@/lib/prisma'
import { getShopBySlug } from '@/lib/tenant'
import { MenuOrder } from '@/components/shop/menu-order'
import type { MenuProduct } from '@/components/shop/menu-order'

export default async function ShopMenuPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  const shop = await getShopBySlug(slug)

  const products = await prisma.product.findMany({
    where: { shopId: shop.id, active: true },
    orderBy: { sortOrder: 'asc' },
  })

  // 商品 config：三语名/描述 + 图片 URL（有图）/emoji 图标（无图占位）
  const plain: MenuProduct[] = products.map((p) => {
    const cfg = p.config as {
      image?: string
      emoji?: string
      nameI18n?: Record<string, string>
      descI18n?: Record<string, string>
      extras?: { name: string; price: number }[]
      optionGroups?: {
        name: string
        required?: boolean
        options: { name: string; price?: number }[]
      }[]
    } | null
    return {
      id: p.id,
      name: cfg?.nameI18n?.[locale] ?? p.name,
      price: p.price.toString(),
      unit: p.unit,
      category: p.category,
      image: cfg?.image ?? '',
      emoji: cfg?.emoji ?? '🍽️',
      desc: cfg?.descI18n?.[locale] ?? '',
      extras: (cfg?.extras ?? []).map((ex) => ({
        name: ex.name,
        price: ex.price.toString(),
      })),
      optionGroups: (cfg?.optionGroups ?? []).map((g) => ({
        name: g.name,
        required: g.required ?? false,
        options: g.options.map((o) => ({
          name: o.name,
          price: (o.price ?? 0).toString(),
        })),
      })),
    }
  })

  const minOrderAmount = Number(
    (shop.config as { minOrderAmount?: number } | null)?.minOrderAmount ?? 0,
  )
  const deliveryFee = Number(
    (shop.config as { deliveryFee?: number } | null)?.deliveryFee ?? 0,
  )
  return (
    <MenuOrder
      slug={slug}
      shopName={shop.name}
      open={shop.open}
      minOrderAmount={minOrderAmount}
      deliveryFee={deliveryFee}
      products={plain}
    />
  )
}
