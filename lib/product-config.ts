// Product.config 类型约束（第 19 批 A6 / 决策 9.3）：字段名锁定，AI 上架/建店写入前统一校验
// .passthrough() 容忍历史数据里的未知键（垂直预留字段），但锁定本 schema 声明字段的类型
import { z } from 'zod'

export const ProductConfigSchema = z
  .object({
    image: z.string().default(''),
    emoji: z.string().default('🍽️'),
    // 三语名/描述（8.5：菜单页按语言读取，缺语种回退 vi→en）
    nameI18n: z.record(z.string(), z.string()).default({}),
    descI18n: z.record(z.string(), z.string()).default({}),
    // 加料（免费项 price=0，收费加料老板后续可改）
    extras: z.array(z.object({ name: z.string(), price: z.number().default(0) })).default([]),
    // 规格组（9.4：AI 预生成不产规格组，老板上架后手动加）
    optionGroups: z
      .array(
        z.object({
          name: z.string(),
          required: z.boolean().default(false),
          options: z.array(z.object({ name: z.string(), price: z.number().default(0) })),
        }),
      )
      .default([]),
    combo: z.array(z.object({ name: z.string(), qty: z.number().default(1) })).default([]),
    bestseller: z.boolean().default(false),
    // 出餐后可追加（READY 阶段客户加菜仅限此商品，默认 true）
    canAddOn: z.boolean().default(true),
    // 8.3 定案：dietary 徽章 + 过敏原（菜单页展示）
    dietaryTags: z.array(z.string()).default([]),
    allergens: z.array(z.string()).default([]),
  })
  .passthrough()

export type ProductConfig = z.infer<typeof ProductConfigSchema>
