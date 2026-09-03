// M6b 凭证页：/{locale}/{vertical}/{slug}/ticket?ticketId=<uuid>，公开只读（无写接口）
// 对齐 food 的 track（track/page.tsx 读 searchParams）：shopSubUrl(...,'ticket',{ticketId}) 生成 /ticket?ticketId=x（query），
// 故本路由读 searchParams.ticketId，与 food 同构；旧的 /ticket/[ticketId]（path）形态废弃（历来的 404、无有效存量）。
// 安全（6.8）：ticketId=randomUUID 不可猜（防遍历）；查不到/取消单 → 404；PII 最小化（不显示完整手机号）
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getShopBySlug, ShopUnavailableError } from '@/lib/tenant'
import { ShopUnavailableView } from '@/components/shop/shop-unavailable'
import { parseVerticalSlug } from '@/lib/vertical'
import { parseCitySlug } from '@/lib/city'
import { MotoTicket } from '@/components/moto/moto-ticket'
import { LaundryTicket } from '@/components/laundry/laundry-ticket'

type PaymentConfig = {
  bank?: { bankName?: string; accountNo?: string; accountName?: string }
  wallet?: { momoQrUrl?: string; zalopayQrUrl?: string }
}

export default async function MotoTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; city: string; vertical: string; slug: string }>
  searchParams: Promise<{ ticketId?: string }>
}) {
  const { slug, city: cityParam, vertical: verticalParam } = await params
  // 凭证路由：MOTO 与 LAUNDRY 共享此页（按 vertical 分流渲染）；其余垂直 404
  const vertical = parseVerticalSlug(verticalParam)
  if (vertical !== 'MOTO' && vertical !== 'LAUNDRY') notFound()
  const city = parseCitySlug(cityParam)
  if (!city) notFound()
  const { ticketId } = await searchParams
  if (!ticketId) notFound()
  let shop: Awaited<ReturnType<typeof getShopBySlug>>
  try {
    shop = await getShopBySlug(slug, { expectVertical: vertical, expectCity: city })
  } catch (e) {
    if (e instanceof ShopUnavailableError) {
      return (
        <ShopUnavailableView reason={e.reason} rejectReason={e.rejectReason} />
      )
    }
    throw e
  }
  // 按 config.ticketId 查单（限定本店）；防遍历：ticketId 不可猜，查不到 → 404
  const order = await prisma.order.findFirst({
    where: { shopId: shop.id, config: { path: ['ticketId'], equals: ticketId } },
  })
  if (!order) notFound()
  const cfg = (order.config as Record<string, unknown> | null) ?? {}
  // 凭证页不展示取消单（cancel 时进度置空）
  const progressKey = vertical === 'LAUNDRY' ? 'laundryStatus' : 'motoProgress'
  if (order.status === 'CANCELLED' || !cfg[progressKey]) notFound()

  // P1 LAUNDRY 凭证：垂直共享同一路由，按 vertical 分流渲染
  if (vertical === 'LAUNDRY') {
    const payment = (shop.config as { payment?: PaymentConfig | null })?.payment ?? null
    return (
      <LaundryTicket
        vertical={shop.vertical}
        slug={slug}
        city={city}
        ticketId={ticketId}
        shopName={shop.name}
        currency={shop.currency}
        payment={payment}
        order={{
          displayNo: order.displayNo,
          status: order.status,
          progress: (cfg.laundryStatus as string) ?? null,
          tagCode: (cfg.tagCode as string) ?? null,
          mode: (cfg.laundryMode as string) ?? 'kg',
          kg: cfg.kg != null ? Number(cfg.kg) : null,
          itemNames: Array.isArray(cfg.itemNames) ? (cfg.itemNames as string[]) : [],
          itemDetail: Array.isArray(cfg.itemDetail) ? (cfg.itemDetail as { name: string; count: number; mark?: string }[]) : [],
          careType: (cfg.careType as string) ?? null,
          qcNote: (cfg.qcNote as string) ?? null,
          dispatchType: (cfg.dispatchType as string) ?? null,
          address: (cfg.address as string) ?? null,
          deliveryFee: cfg.deliveryFee != null ? Number(cfg.deliveryFee) : null,
          photos: Array.isArray(cfg.photo) ? (cfg.photo as string[]) : [],
          total: order.total.toString(),
          paidAmount: order.paidAmount.toString(),
          createdAt: order.createdAt.toISOString(),
        }}
      />
    )
  }

  // 车辆品牌型号（PII 最小化：只取 brand/model，不取 ownerName/ownerPhone）
  const vehicle =
    typeof cfg.vehicleId === 'string'
      ? await prisma.vehicle.findUnique({
          where: { id: cfg.vehicleId },
          select: { brand: true, model: true, plate: true },
        })
      : null
  const payment = (shop.config as { payment?: PaymentConfig | null })?.payment ?? null

  return (
    <MotoTicket
      vertical={shop.vertical}
      slug={slug}
      city={city}
      ticketId={ticketId}
      shopName={shop.name}
      currency={shop.currency}
      payment={payment}
      order={{
        displayNo: order.displayNo,
        status: order.status,
        progress: (cfg.motoProgress as string) ?? null,
        plate: (cfg.plate as string) ?? vehicle?.plate ?? '',
        brand: vehicle?.brand ?? null,
        model: vehicle?.model ?? null,
        symptoms: (cfg.symptom as string[] | undefined) ?? [],
        estimatedDue: (cfg.estimatedDue as string | null) ?? null,
        total: order.total.toString(),
        paidAmount: order.paidAmount.toString(),
        createdAt: order.createdAt.toISOString(),
      }}
    />
  )
}
