// 预设库 server actions（第 19 批 A5/A6）：中台 CRUD（requireAdmin）+ 老板侧开店引导（requireOwner）
'use server'

import { revalidatePath } from 'next/cache'
import { spawn } from 'node:child_process'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireOwner } from '@/lib/dal'
import { ProductConfigSchema } from '@/lib/product-config'
import { generateImage } from '@/lib/llm/image'
import { FOOD_SUBCATEGORIES } from '@/lib/llm/prompts' // 自动归类：子分类三语名注入 categoryI18n（多语言整改）

// 后台生成进行中的子分类（内存去重，防连点重复 spawn；进程重启后失效可接受）
const generating = new Set<string>()

// 启用 / 禁用某子分类预设（active=false 时开店引导不可选）
// 第 20 批：preset 由 (country,cuisine,subcategory) 唯一标识，cuisine 一并传
export async function togglePresetActive(cuisine: string, subcategory: string): Promise<void> {
  await requireAdmin()
  try {
    const preset = await prisma.foodPreset.findFirst({
      where: { country: 'VN', cuisine, subcategory },
    })
    if (!preset) throw new Error(`该子分类暂无预设：${cuisine}/${subcategory}`)
    await prisma.foodPreset.update({
      where: { id: preset.id },
      data: { active: !preset.active },
    })
    revalidatePath('/admin/[locale]/presets', 'page')
  } catch (e) {
    console.error('切换预设启用失败（cuisine=%s subcategory=%s）:', cuisine, subcategory, e)
    throw e
  }
}

// 触发后台重新生成某子分类（detached 不阻塞请求；单类约 8-15 分钟，刷新页面查看）
// 第 20 批：脚本按 meta.cuisine 决定菜系规则；count 用 meta.count（脚本内默认），管理员单类重生成不加 --auto-wait（撞 QUOTA 直接退出，不睡 5h 阻塞）
// 注：spawn 依赖 dev/单实例环境的 pnpm+tsx；生产多实例/无 pnpm 时改为离线跑 scripts/generate-presets.mts
export async function triggerPresetGenerate(
  subcategory: string,
): Promise<{ ok: true; pid: number } | { ok: false; error: string }> {
  await requireAdmin()
  if (generating.has(subcategory)) return { ok: false, error: '该子分类正在后台生成中，请稍候' }
  try {
    const child = spawn(
      'pnpm',
      ['tsx', 'scripts/generate-presets.mts', subcategory],
      { cwd: process.cwd(), detached: true, stdio: 'ignore' }, // cwd=app 根（next dev/start 从 app/ 启动）
    )
    generating.add(subcategory)
    child.on('exit', () => generating.delete(subcategory))
    child.on('error', (e) => {
      generating.delete(subcategory)
      console.error('后台生成启动失败（subcategory=%s）:', subcategory, e)
    })
    child.unref()
    return { ok: true, pid: child.pid ?? 0 }
  } catch (e) {
    console.error('触发后台生成失败（subcategory=%s）:', subcategory, e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---- Admin 全做（第 20 批）：单类预览网格的剔除 / 改 prompt 重生成单图 ----

// 越南语菜名 → ascii slug（与 scripts/generate-presets.mts 一致，供图片归档文件名）
function slugify(s: string): string {
  const ascii = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dish'
}

// 剔除某道菜（人工审核：AI 生成的预设里混入不合适/重图/占位图时移除整道，不删磁盘文件）
export async function removePresetItem(
  cuisine: string,
  subcategory: string,
  nativeName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin()
  try {
    const preset = await prisma.foodPreset.findFirst({ where: { country: 'VN', cuisine, subcategory } })
    if (!preset) return { ok: false, error: '该子分类暂无预设' }
    const items = ((preset.items as PresetDishItem[]) ?? []).filter((it) => it.nativeName !== nativeName)
    if (items.length === ((preset.items as PresetDishItem[]) ?? []).length)
      return { ok: false, error: '未找到该菜品，可能已被剔除' }
    await prisma.foodPreset.update({
      where: { id: preset.id },
      data: { items: items as Prisma.InputJsonValue },
    })
    revalidatePath(`/admin/[locale]/presets/${subcategory}`, 'page')
    return { ok: true }
  } catch (e) {
    console.error('剔除预设菜品失败（cuisine=%s sub=%s name=%s）:', cuisine, subcategory, nativeName, e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 改 prompt 重生成单图（复用 minimax image-01；imagePrompt 用管理员改写的 customPrompt，其余字段保留）
export async function regeneratePresetImage(
  cuisine: string,
  subcategory: string,
  nativeName: string,
  customPrompt: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin()
  const prompt = customPrompt?.trim()
  if (!prompt) return { ok: false, error: '请输入新的图片 prompt' }
  try {
    const preset = await prisma.foodPreset.findFirst({ where: { country: 'VN', cuisine, subcategory } })
    if (!preset) return { ok: false, error: '该子分类暂无预设' }
    const items = (preset.items as PresetDishItem[]) ?? []
    const idx = items.findIndex((it) => it.nativeName === nativeName)
    if (idx < 0) return { ok: false, error: '未找到该菜品，可能已被剔除' }
    // 生成一张新图（写 public/uploads/presets/vn/{sub}/{slug}-*.jpg）
    const img = await generateImage(prompt, { country: 'vn', subcategory, slug: slugify(nativeName) })
    if (!img.ok) return { ok: false, error: img.error }
    const next = [...items]
    next[idx] = { ...items[idx], imageUrl: img.url, imagePrompt: prompt }
    await prisma.foodPreset.update({
      where: { id: preset.id },
      data: { items: next as Prisma.InputJsonValue },
    })
    revalidatePath(`/admin/[locale]/presets/${subcategory}`, 'page')
    return { ok: true }
  } catch (e) {
    console.error('重生成预设图失败（cuisine=%s sub=%s name=%s）:', cuisine, subcategory, nativeName, e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Admin「新增品类」（第 20 批）：注册自定义子分类 meta 到 PresetCategory → 可触发后台生成
// key=子分类 slug（小写字母数字连字符）；cuisine 限 vn/cn/drink；examples 逗号/顿号/换行分隔
export async function createPresetCategory(input: {
  key: string
  nameVi: string
  nameZh: string
  nameEn?: string
  cuisine: string
  count?: number
  examples?: string
}): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  await requireAdmin()
  const key = input.key?.trim().toLowerCase()
  const nameVi = input.nameVi?.trim()
  const nameZh = input.nameZh?.trim()
  if (!key || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key))
    return { ok: false, error: '品类 key 格式错误：小写字母数字 + 连字符' }
  if (!nameVi || !nameZh) return { ok: false, error: '越南语名与中文名必填' }
  const cuisine = input.cuisine === 'cn' || input.cuisine === 'drink' ? input.cuisine : 'vn'
  const count = Math.max(5, Math.min(80, Number(input.count) || 40))
  const examples = (input.examples ?? '')
    .split(/[,，、\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  try {
    const cat = await prisma.presetCategory.upsert({
      where: { key },
      update: { nameVi, nameZh, nameEn: input.nameEn?.trim() || nameVi, cuisine, count, examples },
      create: { key, nameVi, nameZh, nameEn: input.nameEn?.trim() || nameVi, cuisine, count, examples },
    })
    revalidatePath('/admin/[locale]/presets', 'page')
    return { ok: true, key: cat.key }
  } catch (e) {
    console.error('新增预设品类失败（key=%s）:', key, e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---- 老板侧：开店引导（A6，requireOwner） ----

// FoodPreset.items 里的单道菜（生成时落库结构；多语言整改：加 description_zh/extras_zh/unit/categoryI18n）
type PresetDishItem = {
  nativeName: string
  name_en: string
  name_zh: string
  description_local: string
  description_zh?: string // 中文描述（多语言整改）
  description_en: string
  defaultPrice: number
  currency?: string
  unit?: string // 越南语计量单位
  unit_zh?: string // 中文计量单位
  extras?: string[]
  extras_zh?: string[] // 中文加料（与 extras 一一对应）
  optionGroups?: { name: string; nameZh?: string; options: { name: string; nameZh?: string; price: number }[] }[] // 第 20 批酒水规格
  allergens?: string[]
  dietaryTags?: string[]
  imagePrompt?: string
  imageUrl?: string
  categoryI18n?: { vi: string; zh: string; en: string } // 自动归类：子分类三语名（多语言整改）
}

// 老板编辑后的草稿菜品（客户端可改名/改价，上架时提交）
export type DraftItem = {
  nativeName: string
  nameZh: string
  nameEn: string
  descVi: string
  descZh: string // 中文描述（多语言整改）
  descEn: string
  price: number
  unit: string // 越南语计量单位
  unitZh: string // 中文计量单位
  extras: string[]
  extrasZh: string[] // 中文加料（与 extras 一一对应）
  optionGroups: { name: string; nameZh?: string; options: { name: string; nameZh?: string; price: number }[] }[] // 第 20 批酒水规格
  allergens: string[]
  dietaryTags: string[]
  imageUrl: string
  categoryI18n?: { vi: string; zh: string; en: string } // 自动归类：子分类三语名
}

// 把选中子分类的 FoodPreset items 拉入 ShopDraft（9.1：独立表，不混 jsonb）
export async function saveShopDraft(
  subcategories: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const user = await requireOwner()
  try {
    const subs = [...new Set(subcategories.map((s) => s.trim()).filter(Boolean))]
    if (!subs.length) return { ok: false, error: '请至少选择一个子分类' }
    const presets = await prisma.foodPreset.findMany({
      where: { country: 'VN', subcategory: { in: subs }, active: true },
    })
    if (!presets.length) return { ok: false, error: '所选子分类暂无可用预设（可能未生成或已停用）' }
    // 自动归类（用户 2026-08-29）：每道菜注入 categoryI18n = 所属子分类的三语名，
    // 菜单按语种分组显示分类（中文客户看中文分类，越南客户看越南语分类）
    const customCats = await prisma.presetCategory.findMany({ where: { active: true, key: { in: subs } } })
    const catMeta: Record<string, { vi: string; zh: string; en: string }> = Object.fromEntries(
      customCats.map((c) => [c.key, { vi: c.nameVi, zh: c.nameZh, en: c.nameEn }]),
    )
    const items = presets.flatMap((p) => {
      const meta = FOOD_SUBCATEGORIES[p.subcategory] ?? catMeta[p.subcategory]
      const categoryI18n = meta ? { vi: meta.vi, zh: meta.zh, en: meta.en } : undefined
      return ((p.items as PresetDishItem[]) ?? []).map((it) => ({ ...it, categoryI18n }))
    })
    await prisma.shopDraft.upsert({
      where: { shopId: user.shopId },
      update: { items: items as Prisma.InputJsonValue, presetId: presets[0]?.id ?? null },
      create: { shopId: user.shopId, items: items as Prisma.InputJsonValue, presetId: presets[0]?.id ?? null },
    })
    revalidatePath('/[locale]/dashboard', 'page')
    return { ok: true, count: items.length }
  } catch (e) {
    console.error('保存草稿失败（shopId=%s）:', user.shopId, e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// DraftItem → Product.config（9.3 schema 校验；8.3 dietaryTags/allergens 落 Product.config）
// 第 20 批：酒水规格 optionGroups 一并落 config（产品级规格组）
function buildProductConfig(it: DraftItem) {
  return {
    image: it.imageUrl?.trim() ?? '',
    emoji: '🍽️',
    nameI18n: { vi: it.nativeName, zh: it.nameZh ?? '', en: it.nameEn ?? '' },
    // 多语言整改：中文描述用 descZh（缺失才回退越南语），不再硬编码 vi 顶替
    descI18n: { vi: it.descVi ?? '', zh: it.descZh ?? it.descVi ?? '', en: it.descEn ?? '' },
    unitI18n: { vi: it.unit ?? '', zh: it.unitZh ?? '', en: '' }, // 多语言整改：计量单位三语
    categoryI18n: it.categoryI18n ?? {}, // 自动归类：子分类三语名
    extras: (it.extras ?? []).map((n, i) => ({ name: n, nameZh: it.extrasZh?.[i] ?? '', price: 0 })),
    optionGroups: (it.optionGroups ?? []).map((g) => ({
      name: g.name,
      nameZh: g.nameZh ?? '',
      options: (g.options ?? []).map((o) => ({ name: o.name, nameZh: o.nameZh ?? '', price: o.price ?? 0 })),
    })),
    combo: [],
    bestseller: false,
    canAddOn: true,
    dietaryTags: it.dietaryTags ?? [],
    allergens: it.allergens ?? [],
  }
}

// 一键上架（追加模式，2026-08-29 用户反馈）：勾选的草稿菜**追加**到现有菜单尾部，
// 不清空/不覆盖店内已有商品（此前为覆盖设计，用户确认不合理）；上架成功清草稿 items。
export async function publishShopDraft(
  items: DraftItem[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const user = await requireOwner()
  try {
    const valid = items.filter((i) => i.nativeName?.trim() && Number.isFinite(i.price) && i.price > 0)
    if (!valid.length) return { ok: false, error: '没有可上架的菜品（名称或价格无效）' }
    for (const it of valid) {
      const r = ProductConfigSchema.safeParse(buildProductConfig(it))
      if (!r.success)
        return { ok: false, error: `商品「${it.nativeName}」配置校验失败：${r.error.issues[0]?.message ?? ''}` }
    }

    // 追加：新菜排到现有商品之后（sortOrder 接尾部），不清空已有商品
    const last = await prisma.product.findFirst({
      where: { shopId: user.shopId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })
    const baseSort = last ? last.sortOrder + 1 : 0

    await prisma.$transaction(async (tx) => {
      for (let idx = 0; idx < valid.length; idx++) {
        const it = valid[idx]
        await tx.product.create({
          data: {
            shopId: user.shopId,
            name: it.nativeName.trim(),
            price: it.price,
            // 自动归类（多语言整改）：DB 列存本地语，i18n 三语在 config.categoryI18n / unitI18n
            unit: it.unit ?? null,
            category: it.categoryI18n?.vi ?? null,
            sortOrder: baseSort + idx,
            config: buildProductConfig(it) as Prisma.InputJsonValue,
          },
        })
      }
    })
    // 上架成功 → 清草稿 items（保留 snapshot 供「还原上次」）
    const draft = await prisma.shopDraft.findUnique({ where: { shopId: user.shopId } })
    if (draft) await prisma.shopDraft.update({ where: { id: draft.id }, data: { items: [] } })
    revalidatePath('/[locale]/dashboard', 'page')
    return { ok: true, count: valid.length }
  } catch (e) {
    console.error('一键上架失败（shopId=%s）:', user.shopId, e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 一键还原：恢复覆盖前的快照 Product[]，清快照
export async function restoreShopDraft(): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const user = await requireOwner()
  try {
    const draft = await prisma.shopDraft.findUnique({ where: { shopId: user.shopId } })
    const snapshot = (draft?.snapshot as
      | { name: string; price: number; unit: string | null; category: string | null; sortOrder: number; active: boolean; config: Prisma.InputJsonValue }[]
      | null) ?? null
    if (!snapshot?.length) return { ok: false, error: '没有可还原的快照（覆盖前菜单快照为空）' }
    await prisma.$transaction(async (tx) => {
      await tx.product.deleteMany({ where: { shopId: user.shopId } })
      for (const s of snapshot) {
        await tx.product.create({
          data: { shopId: user.shopId, name: s.name, price: s.price, unit: s.unit, category: s.category, sortOrder: s.sortOrder, active: s.active, config: s.config as Prisma.InputJsonValue },
        })
      }
    })
    // Prisma 7：可空 Json 置 SQL NULL 需显式 Prisma.JsonNull（直接 null 会报 TS2322）
    if (draft) await prisma.shopDraft.update({ where: { id: draft.id }, data: { snapshot: Prisma.JsonNull } })
    revalidatePath('/[locale]/dashboard', 'page')
    return { ok: true, count: snapshot.length }
  } catch (e) {
    console.error('还原快照失败（shopId=%s）:', user.shopId, e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
