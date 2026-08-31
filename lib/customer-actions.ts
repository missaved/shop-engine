'use server'
// M6a 客户自助查询 server actions：注册 / 认领车辆 / 我的车辆 / 匿名查询
// 认领捆绑强制（检查点）：查绑定内容必须先认领（Vehicle.ownerCustomerId）；匿名查询只给当前/最近单只读
import { prisma } from '@/lib/prisma'
import { hash } from 'bcryptjs'
import { getShopBySlug } from '@/lib/tenant'
import { requireCustomer } from '@/lib/dal'
import { normalizePhone } from '@/lib/phone'
import { normalizePlate } from '@/lib/plate'

// 统一返回：ok=false 时 error 为文案 key（客户组件用 t(`customer.${error}`) 渲染）
export type CustomerResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// 客户查到的订单简表（金额字符串，前端 formatPrice）
export type CustomerOrder = {
  id: string
  displayNo: string
  progress: string | null // motoProgress 六态，前端映射文案
  total: string
  paidAmount: string
  createdAt: string
}

export type MyVehicle = {
  id: string
  plate: string
  brand: string | null
  model: string | null
  year: number | null
  mileage: number | null
  nextServiceKm: number | null
  nextServiceDue: string | null
  // 当前在修单（最新且未交接）；无则为 null
  currentOrder: CustomerOrder | null
  // 历史维保（已交接/完成的最近 10 单）
  history: CustomerOrder[]
}

// 注册客户账号（6.1）：手机号+密码。登录由 auth.ts customer provider 处理，这里只管建号
export async function registerCustomer(input: {
  phone: string
  password: string
  name?: string
}): Promise<CustomerResult> {
  try {
    const phone = normalizePhone(input.phone)
    const pwd = input.password ?? ''
    if (!phone || pwd.length < 4) return { ok: false, error: 'invalid' }
    const exists = await prisma.customer.findUnique({ where: { phone } })
    if (exists) return { ok: false, error: 'registered' }
    await prisma.customer.create({
      data: {
        phone,
        passwordHash: await hash(pwd, 10),
        name: input.name?.trim() || null,
      },
    })
    return { ok: true, data: undefined }
  } catch (e) {
    console.error('客户注册失败:', e)
    return { ok: false, error: 'error' }
  }
}

// 认领车辆（6.3）：手机号匹配自动认领。登录客户在本店输车牌，Vehicle.ownerPhone === 客户手机号 → 绑定
export async function claimVehicle(
  slug: string,
  plate: string,
): Promise<CustomerResult> {
  try {
    const shop = await getShopBySlug(slug, { expectVertical: 'MOTO' })
    const customer = await requireCustomer(slug, shop.vertical)
    const normPlate = normalizePlate(plate)
    if (!normPlate) return { ok: false, error: 'notFound' }
    const vehicle = await prisma.vehicle.findUnique({
      where: { shopId_plate: { shopId: shop.id, plate: normPlate } },
    })
    if (!vehicle) return { ok: false, error: 'notFound' }
    if (vehicle.ownerCustomerId === customer.customerId) {
      // 已认领，幂等返回成功
      return { ok: true, data: undefined }
    }
    // 手机号匹配才自动认领（店里的车主手机号与登录客户一致）；否则提示联系店主。
    // 身份融合（2026-08-31）：OAuth 客户可无手机号（phone 为 null）——这种情况下不硬判 mismatch，
    // 而是提示联系店主由后台人工绑定（不能用 undefined 恒不等于改判失败）。
    if (customer.phone && vehicle.ownerPhone === customer.phone) {
      await prisma.vehicle.update({
        where: { id: vehicle.id },
        data: { ownerCustomerId: customer.customerId },
      })
      return { ok: true, data: undefined }
    }
    return { ok: false, error: 'phoneMismatch' }
  } catch (e) {
    console.error('认领车辆失败:', e)
    return { ok: false, error: 'error' }
  }
}

// 我的车辆（6.4）：当前店 + 已认领的车辆 → 卡片（含当前在修单/历史维保/下次保养）
export async function getMyVehicles(slug: string): Promise<CustomerResult<MyVehicle[]>> {
  try {
    const shop = await getShopBySlug(slug, { expectVertical: 'MOTO' })
    const customer = await requireCustomer(slug, shop.vertical)
    const vehicles = await prisma.vehicle.findMany({
      where: { shopId: shop.id, ownerCustomerId: customer.customerId },
      orderBy: { createdAt: 'desc' },
    })
    const list: MyVehicle[] = []
    for (const v of vehicles) {
      const orders = await prisma.order.findMany({
        where: {
          shopId: shop.id,
          status: { not: 'CANCELLED' },
          config: { path: ['plate'], equals: v.plate },
        },
        orderBy: { createdAt: 'desc' },
        take: 11,
      })
      const plainOrders = orders.map((o) => ({
        id: o.id,
        displayNo: o.displayNo,
        progress: (o.config as { motoProgress?: string | null } | null)?.motoProgress ?? null,
        total: o.total.toString(),
        paidAmount: o.paidAmount.toString(),
        createdAt: o.createdAt.toISOString(),
      }))
      // 当前在修单 = 最新未交接（progress != picked_up）；历史 = 已交接的最近单
      const currentIdx = plainOrders.findIndex((o) => o.progress !== 'picked_up')
      list.push({
        id: v.id,
        plate: v.plate,
        brand: v.brand,
        model: v.model,
        year: v.year,
        mileage: v.mileage,
        nextServiceKm: v.nextServiceKm,
        nextServiceDue: v.nextServiceDue?.toISOString() ?? null,
        currentOrder: currentIdx >= 0 ? plainOrders[currentIdx] : null,
        history: plainOrders.filter((o) => o.progress === 'picked_up').slice(0, 10),
      })
    }
    return { ok: true, data: list }
  } catch (e) {
    console.error('我的车辆加载失败:', e)
    return { ok: false, error: 'error' }
  }
}

// 匿名查询（6.3b）：车牌 + 手机号后 4 位 → 当前/最近维修详单（只读，不登录）
export async function getVehicleAnonStatus(
  slug: string,
  plate: string,
  phoneTail: string,
): Promise<CustomerResult<{ vehicle: MyVehicle | null }>> {
  try {
    const shop = await getShopBySlug(slug, { expectVertical: 'MOTO' })
    const normPlate = normalizePlate(plate)
    const tail = (phoneTail ?? '').trim()
    if (!normPlate || !tail) return { ok: false, error: 'invalid' }
    const vehicle = await prisma.vehicle.findUnique({
      where: { shopId_plate: { shopId: shop.id, plate: normPlate } },
    })
    if (!vehicle) return { ok: false, error: 'notFound' }
    // 手机号后 4 位校验（车主手机号末尾匹配），防随便输车牌窥探
    const owner = vehicle.ownerPhone ?? ''
    if (!owner.endsWith(tail)) return { ok: false, error: 'phoneMismatch' }
    const orders = await prisma.order.findMany({
      where: {
        shopId: shop.id,
        status: { not: 'CANCELLED' },
        config: { path: ['plate'], equals: normPlate },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })
    const plainOrders = orders.map((o) => ({
      id: o.id,
      displayNo: o.displayNo,
      progress: (o.config as { motoProgress?: string | null } | null)?.motoProgress ?? null,
      total: o.total.toString(),
      paidAmount: o.paidAmount.toString(),
      createdAt: o.createdAt.toISOString(),
    }))
    const currentIdx = plainOrders.findIndex((o) => o.progress !== 'picked_up')
    const myV: MyVehicle = {
      id: vehicle.id,
      plate: vehicle.plate,
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      mileage: vehicle.mileage,
      nextServiceKm: vehicle.nextServiceKm,
      nextServiceDue: vehicle.nextServiceDue?.toISOString() ?? null,
      currentOrder: currentIdx >= 0 ? plainOrders[currentIdx] : null,
      history: plainOrders.filter((o) => o.progress === 'picked_up'),
    }
    return { ok: true, data: { vehicle: myV } }
  } catch (e) {
    console.error('匿名查询失败:', e)
    return { ok: false, error: 'error' }
  }
}
