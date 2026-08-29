// 菜单序列化 + 推荐接口（非 'use server'，RSC 页面直接 import 纯服务函数）
// 背景：'use server' 模块不能导出只读 helper（会变成 server action / RPC 端点）；
// 推荐查询与商品序列化放普通 server 模块，被客户菜单页 / 查单页直接 import。
// 纯服务端模块，禁止被任何 client 组件 import（内部使用 prisma）。
import { prisma } from '@/lib/prisma'
import { getShopBySlug } from '@/lib/tenant'
import type { MenuProduct } from '@/components/shop/menu-order'

// 商品描述缺当前语种时回退到任一已有语种（主文案一般取 vi），避免只配部分语言的商品详情无简介
const DESC_FALLBACK_ORDER = ['vi', 'zh', 'en', 'ms', 'th', 'zh-Hant'] as const
function fallbackDesc(descI18n: Record<string, string> | undefined): string {
  if (!descI18n) return ''
  for (const l of DESC_FALLBACK_ORDER) {
    if (descI18n[l]) return descI18n[l]
  }
  return ''
}

// 多语言整改（2026-08-29）：zh/zh-Hant 归 zh，en 归 en，其余（vi/ms/th）归 vi 主语言
const LANGS: Record<string, string> = { zh: 'zh', 'zh-Hant': 'zh', en: 'en' }
// 从 {vi,zh,en} 三语对象按 locale 取值，缺则回退 vi / 兜底值
function pickI18n<T>(i18n: Record<string, T> | undefined, locale: string, fallback: T): T {
  if (!i18n) return fallback
  const key = LANGS[locale] ?? 'vi'
  return i18n[key] || i18n.vi || fallback
}
// 中文 locale 用 nameZh，否则用主语言 name（加料/规格项）
function zhName(locale: string, name: string, nameZh?: string): string {
  return (locale === 'zh' || locale === 'zh-Hant') && nameZh ? nameZh : name
}

// 商品行 → MenuProduct（把 Decimal/可空字段转基础类型 + 按 locale 取三语名/描述）
// MenuProduct 的 12 个字段都要填全（track 页加菜区 / 菜单主页共用，缺字段会静默缺失）
export function serializeMenuProduct(
  p: {
    id: string
    name: string
    price: { toString(): string }
    unit: string | null
    category: string | null
    config: unknown
  },
  locale: string,
): MenuProduct {
  const cfg = p.config as {
    image?: string
    emoji?: string
    nameI18n?: Record<string, string>
    descI18n?: Record<string, string>
    unitI18n?: Record<string, string>
    categoryI18n?: Record<string, string>
    extras?: { name: string; nameZh?: string; price: number }[]
    optionGroups?: {
      name: string
      nameZh?: string
      required?: boolean
      options: { name: string; nameZh?: string; price?: number }[]
    }[]
    combo?: { name: string; qty: number }[]
    bestseller?: boolean
    canAddOn?: boolean
  } | null
  return {
    id: p.id,
    name: cfg?.nameI18n?.[locale] ?? p.name,
    price: p.price.toString(),
    // 多语言整改：单位/分类按语种取（自动归类 categoryI18n），缺则回退 DB 列
    unit: pickI18n(cfg?.unitI18n, locale, p.unit),
    category: pickI18n(cfg?.categoryI18n, locale, p.category),
    image: cfg?.image ?? '',
    emoji: cfg?.emoji ?? '🍽️',
    desc: cfg?.descI18n?.[locale] ?? fallbackDesc(cfg?.descI18n),
    extras: (cfg?.extras ?? []).map((ex) => ({
      name: zhName(locale, ex.name, ex.nameZh),
      price: ex.price.toString(),
    })),
    optionGroups: (cfg?.optionGroups ?? []).map((g) => ({
      name: zhName(locale, g.name, g.nameZh),
      required: g.required ?? false,
      options: g.options.map((o) => ({
        name: zhName(locale, o.name, o.nameZh),
        price: (o.price ?? 0).toString(),
      })),
    })),
    combo: (cfg?.combo ?? []).map((c) => ({ name: c.name, qty: c.qty })),
    bestseller: cfg?.bestseller ?? false,
    // 出餐后可追加（默认可追加，老板手动收窄）
    canAddOn: cfg?.canAddOn ?? true,
  }
}

// 推荐接口：该店推荐菜（bestseller 优先）数组，供下单成功页 / 查单页渲染推荐网格。
// 分条件显示（memo §3）：查单页加菜区仅订单未结束时显示；READY（待取餐）阶段只推
// canAddOn 商品（出餐后还能加，如烧烤摊临时加饮料/小菜），PENDING/IN_PROGRESS 推全量。
export async function getRecommendedProducts(params: {
  slug: string
  locale: string
  limit?: number
  orderStatus?: string
}): Promise<MenuProduct[]> {
  const { slug, locale, limit = 60, orderStatus } = params
  const shop = await getShopBySlug(slug)
  const products = await prisma.product.findMany({
    where: { shopId: shop.id, active: true },
    orderBy: [{ sortOrder: 'asc' }],
  })
  // READY 阶段：只保留「可追加」商品（出餐后还能加）
  const pool =
    orderStatus === 'READY'
      ? products.filter((p) => {
          const cfg = p.config as { canAddOn?: boolean } | null
          return cfg?.canAddOn !== false
        })
      : products
  // 热销置顶（bestseller），其余保持录入顺序
  const ranked = [...pool].sort((a, b) => {
    const cfgA = a.config as { bestseller?: boolean } | null
    const cfgB = b.config as { bestseller?: boolean } | null
    return (cfgB?.bestseller ? 1 : 0) - (cfgA?.bestseller ? 1 : 0)
  })
  return ranked.slice(0, limit).map((p) => serializeMenuProduct(p, locale))
}
