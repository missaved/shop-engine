// M6b 凭证页：/{locale}/{vertical}/{slug}/ticket/[ticketId]，公开只读（无写接口）
// 安全（6.8）：ticketId=randomUUID 不可猜（防遍历）；查不到/取消单 → 404；PII 最小化（不显示完整手机号）
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getShopBySlug, ShopUnavailableError } from '@/lib/tenant'
import { ShopUnavailableView } from '@/components/shop/shop-unavailable'
import { parseVerticalSlug } from '@/lib/vertical'
import { parseCitySlug } from '@/lib/city'
import { MotoTicket } from '@/components/moto/moto-ticket'

type PaymentConfig = {
  bank?: { bankName?: string; accountNo?: string; accountName?: string }
  wallet?: { momoQrUrl?: string; zalopayQrUrl?: string }
}

export default async function MotoTicketPage({
  params,
}: {
  params: Promise<{ locale: string; city: string; vertical: string; slug: string; ticketId: string }>
}) {
  const { slug, city: cityParam, vertical: verticalParam, ticketId } = await params
  // 凭证路由为 moto 专属：URL 垂直段必须是 moto，否则 404（收敛 assertMotoShop）
  const vertical = parseVerticalSlug(verticalParam)
  if (vertical !== 'MOTO') notFound()
  const city = parseCitySlug(cityParam)
  if (!city) notFound()
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
  // 按 config.ticketId 查单（限定本店）；防遍历：ticketId 不可猜，查不到 → 404
  const order = await prisma.order.findFirst({
    where: { shopId: shop.id, config: { path: ['ticketId'], equals: ticketId } },
  })
  if (!order) notFound()
  const cfg = (order.config as Record<string, unknown> | null) ?? {}
  // 凭证页不展示取消单（cancel 时 motoProgress 置空，此处一并拦截）
  if (order.status === 'CANCELLED' || !cfg.motoProgress) notFound()

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
