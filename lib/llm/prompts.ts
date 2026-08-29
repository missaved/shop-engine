// 菜品预生成的 prompt 与输出 schema（第 19 批 A2/A4 + 第 20 批目录 v4 大扩）
// 第 20 批：中越拆分（cuisine 维度 vn/cn/drink）+ 酒水真实品牌中性图 + 每类按维度铺满（不成孤立图片）
// 规格组（optionGroups）：9.4 曾定案「规格因店而异不产」，第 20 批用户明确「酒水还有规格」
//   → 仅酒水类由脚本按模板（FOOD_SUBCATEGORIES[].optionGroups）确定性挂载，不经 LLM 生成（避免 AI 编造规格）
import { z } from 'zod'

// 可用的饮食标签（8.3 定案，菜单页显示徽章）
export const DIETARY_TAGS = ['halal', 'vegetarian', 'spicy', 'gluten-free'] as const

// LLM 可能给变体（'gluten free'/'Spicy'/越南词 chay/cay/khong...），归一化到白名单，未知丢弃
function normalizeDietary(t: string): string {
  const s = t.trim().toLowerCase().replace(/[🌶️🍃🥬🕌]+/g, '')
  if (s.includes('gluten') || s.includes('麸质')) return 'gluten-free'
  if (s.includes('veget') || s.includes('vegan') || s.includes('素') || s.includes('chay')) return 'vegetarian'
  if (s.includes('spicy') || s.includes('cay') || s.includes('辣')) return 'spicy'
  if (s.includes('halal') || s.includes('清真')) return 'halal'
  return s
}

// 价格宽容解析：容忍 '40,000' / '40000đ' / 数字字符串，抹零为整数 VND
const coercePrice = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(/[^0-9]/g, '')) : v),
  z.number().int().positive(),
)

// 规格组（酒水/锅底用，脚本确定性挂载，不经 LLM）
export const DishOptionGroupSchema = z.object({
  name: z.string().min(1), // 规格组名（本地语，如 Quy cách）
  nameZh: z.string().optional(), // 中文规格组名（多语言整改，如「规格」）
  options: z
    .array(
      z.object({
        name: z.string().min(1), // 规格项名（本地语，如 Chai 330ml）
        nameZh: z.string().optional(), // 中文规格项名（多语言整改，如「瓶装 330ml」）
        price: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1),
})

// 单道菜（与 FoodPreset.items 元素对齐）
export const DishItemSchema = z.object({
  nativeName: z.string().min(1), // 本地名（vn 主语言；cn 类=越南语菜名；drink 类=越南语品牌拼写）
  name_en: z.string().min(1),
  name_zh: z.string().min(1), // 中文译名（cn 类=中文原名）
  description_local: z.string().min(1), // 本地语描述（越南语）
  description_zh: z.string().min(1), // 中文描述（多语言整改：中文界面显示中文介绍，2026-08-29）
  description_en: z.string().min(1),
  defaultPrice: coercePrice, // VND 整数（10.1 按当地习惯抹零）
  unit: z.string().optional(), // 越南语计量单位（如 tô/phần/cái/lon；多语言整改）
  unit_zh: z.string().optional(), // 中文计量单位（与 unit 对应，如 碗/份/个/罐）
  extras: z.array(z.string()).default([]), // 加料（越南语，额外收费项）
  extras_zh: z.array(z.string()).default([]), // 中文加料（与 extras 一一对应；多语言整改）
  optionGroups: z.array(DishOptionGroupSchema).default([]), // 规格组（第 20 批：酒水由脚本挂载模板）
  allergens: z.array(z.string()).default([]), // 过敏原（自由文本，如 花生/甲壳类）
  dietaryTags: z
    .array(z.string())
    .default([])
    .transform((tags) =>
      tags.map(normalizeDietary).filter((t): t is (typeof DIETARY_TAGS)[number] => (DIETARY_TAGS as readonly string[]).includes(t)),
    ),
  imagePrompt: z.string().min(1), // 交给文生图的 prompt（A3；drink 类=中性描述不带商标）
})
export type DishItem = z.infer<typeof DishItemSchema>

// 一次批量生成的输出
export const DishBatchSchema = z.object({ dishes: z.array(DishItemSchema).min(1).max(60) })
export type DishBatch = z.infer<typeof DishBatchSchema>

// ---- 第 20 批：目录 v4（35 类，中越拆分 + 酒水品牌）----

export type Cuisine = 'vn' | 'cn' | 'drink'

export type OptionGroupTemplate = {
  name: string // 规格组名（本地语，如 Quy cách）
  nameZh?: string // 中文规格组名（多语言整改，如「规格」）
  options: { name: string; nameZh?: string; price: number }[] // 各规格与差价（默认 0）
}

export type SubcategoryMeta = {
  vi: string // 越南语分类名
  en: string
  zh: string
  cuisine: Cuisine // vn 越南菜 / cn 中国菜 / drink 酒水饮品
  count: number // 每类目标道数（天然小项 15-25，避免编造充数）
  examples: string[] // 维度指引（用户 2026-08-28：「多方位考虑，不孤立」）——参考而非限定
  optionGroups?: OptionGroupTemplate[] // 规格组模板（仅酒水类，脚本确定性挂载）
}

// 规格模板（酒水「酒水还有规格」，用户 2026-08-28 定；多语言整改：越南语主名 + 中文 nameZh）
const SPEC = {
  beer: [
    {
      name: 'Quy cách',
      nameZh: '规格',
      options: [
        { name: 'Chai 330ml', nameZh: '瓶装 330ml', price: 0 },
        { name: 'Lon 330ml', nameZh: '罐装 330ml', price: 0 },
        { name: 'Chai lớn 640ml', nameZh: '大瓶 640ml', price: 0 },
      ],
    },
  ],
  softDrink: [
    {
      name: 'Quy cách',
      nameZh: '规格',
      options: [
        { name: 'Chai 330ml', nameZh: '瓶装 330ml', price: 0 },
        { name: 'Lon 330ml', nameZh: '罐装 330ml', price: 0 },
      ],
    },
  ],
  alcohol: [
    {
      name: 'Quy cách',
      nameZh: '规格',
      options: [
        { name: 'Ly đơn', nameZh: '单杯', price: 0 },
        { name: 'Cả chai', nameZh: '整瓶', price: 0 },
      ],
    },
  ],
  water: [
    {
      name: 'Quy cách',
      nameZh: '规格',
      options: [
        { name: 'Chai 550ml', nameZh: '瓶装 550ml', price: 0 },
        { name: 'Chai lớn 1.5L', nameZh: '大瓶 1.5L', price: 0 },
      ],
    },
  ],
  // 中国酒水饮品（cn-drinks，2026-08-29 用户报「中国的酒水饮料没有」）：中国餐厅配套饮料/啤酒/白酒
  cnDrinks: [
    {
      name: 'Quy cách',
      nameZh: '规格',
      options: [
        { name: 'Chai 500ml', nameZh: '瓶装 500ml', price: 0 },
        { name: 'Lon 330ml', nameZh: '罐装 330ml', price: 0 },
      ],
    },
  ],
} satisfies Record<string, OptionGroupTemplate[]>

export const FOOD_SUBCATEGORIES: Record<string, SubcategoryMeta> = {
  // ================= 越南菜（cuisine=vn，13 类） =================
  pho: {
    vi: 'Phở', en: 'Pho & noodle soups', zh: '河粉/汤粉', cuisine: 'vn', count: 40,
    examples: [
      'Phở bò tái 生牛肉粉', 'Phở bò chín 熟牛肉粉', 'Phở gà 鸡肉粉', 'Phở gà xé 手撕鸡粉',
      'Phở bò viên 牛肉丸粉', 'Phở tái lăn 现烫牛肉粉', 'Phở sốt vang 红酒炖牛肉粉', 'Phở trộn 凉拌河粉',
      'Phở xào 炒河粉', 'Phở cuốn 卷粉', 'Phở chua cay 酸辣粉', 'Phở cá 鱼肉粉', 'Phở vịt 鸭肉粉',
      'Phở bò nạm 牛腩粉', 'Phở bò gầu 牛胸肉粉', 'Phở bò sách 牛肚粉', 'Phở bò gân 牛筋粉',
      'Phở tôm 虾粉', 'Phở chay 素粉', 'Phở sườn 排骨粉', 'Phở ếch 田鸡粉', 'Phở mực 鱿鱼粉',
      'Phở hải sản 海鲜粉', 'Phở bò nướng 烤牛肉粉', 'Phở nấm 菌菇粉', 'Phở kim chi 泡菜粉',
    ],
  },
  bun: {
    vi: 'Bún', en: 'Rice vermicelli', zh: '米粉米线', cuisine: 'vn', count: 40,
    examples: [
      'Bún thịt nướng 烤猪肉米粉', 'Bún chả Hà Nội 河内烤肉米粉', 'Bún bò Huế 顺化牛肉粉',
      'Bún riêu cua 蟹肉汤粉', 'Bún mắm 鱼酱粉', 'Bún đậu mắm tôm 豆腐虾酱粉', 'Bún ốc 田螺粉',
      'Bún cá 鱼肉米粉', 'Bún chả cá 鱼饼米粉', 'Bún nem 春卷米粉', 'Bún chay 素米粉',
      'Bún thang 什锦汤粉', 'Bún xào 炒米粉', 'Bún hến 蛤蜊粉', 'Bún mọc 丸子粉',
      'Bún sườn 排骨粉', 'Bún nước lèo 南越浓汤粉', 'Bún tôm 虾米粉', 'Bún gà 鸡肉米粉', 'Bún đậu 豆腐米粉',
    ],
  },
  'banh-mi': {
    vi: 'Bánh mì', en: 'Banh mi & sandwiches', zh: '越式法棍', cuisine: 'vn', count: 40,
    examples: [
      'Bánh mì thịt nướng 烤肉法棍', 'Bánh mì gà xé 手撕鸡法棍', 'Bánh mì chả cá 鱼饼法棍',
      'Bánh mì xíu mại 烧卖法棍', 'Bánh mì pate 鹅肝酱法棍', 'Bánh mì chả lụa 越式火腿法棍',
      'Bánh mì bò kho 炖牛肉法棍', 'Bánh mì gà nướng 烤鸡法棍', 'Bánh mì heo quay 烧肉法棍',
      'Bánh mì ốp la 煎蛋法棍', 'Bánh mì trứng muối 咸蛋法棍', 'Bánh mì cá mòi 沙丁鱼法棍',
      'Bánh mì chay 素法棍', 'Bánh mì bì 猪皮法棍', 'Bánh mì đặc biệt 招牌法棍',
      'Bánh mì bò nướng 烤牛肉法棍', 'Bánh mì cá hồi 三文鱼法棍', 'Bánh mì bơ tỏi 蒜香牛油法棍',
      'Bánh mì chảo 煎锅法棍', 'Bánh mì que 法棍条', 'Bánh mì nướng muối ớt 椒盐烤法棍',
    ],
  },
  com: {
    vi: 'Cơm', en: 'Rice dishes', zh: '越南米饭', cuisine: 'vn', count: 40,
    examples: [
      'Cơm tấm sườn 碎米猪排饭', 'Cơm gà 鸡饭', 'Cơm gà xối mỡ 脆皮油鸡饭',
      'Cơm chiên Dương Châu 扬州炒饭', 'Cơm chiên hải sản 海鲜炒饭', 'Cơm chiên trứng 蛋炒饭',
      'Cơm chiên bò 牛肉炒饭', 'Cơm cá kho tộ 砂锅鱼饭', 'Cơm sườn nướng 烤排骨饭',
      'Cơm thịt kho 红烧肉饭', 'Cơm gà hấp lá chanh 香茅蒸鸡饭', 'Cơm hến 蛤蜊饭',
      'Cơm lam 竹筒饭', 'Cơm cuộn 越南饭卷', 'Cơm vịt quay 烧鸭饭', 'Cơm bò lúc lắc 摇摇牛肉饭',
      'Cơm tấm đặc biệt 招牌碎米饭', 'Cơm rang dưa bò 酸菜牛肉饭', 'Cơm thập cẩm 什锦饭',
      'Cơm gà xé 手撕鸡饭', 'Cơm chay 素饭', 'Cơm ếch xào 田鸡饭', 'Cơm heo quay 烧肉饭',
    ],
  },
  'hotpot-vn-base': {
    vi: 'Lẩu nước', en: 'Hotpot broths (VN)', zh: '越式火锅锅底', cuisine: 'vn', count: 20,
    examples: [
      'Lẩu thái 泰式酸辣锅底', 'Lẩu gà lá giang 酸叶鸡汤锅底', 'Lẩu bò 牛肉锅底',
      'Lẩu cá lăng 鲶鱼锅底', 'Lẩu ếch 田鸡锅底', 'Lẩu hải sản 海鲜锅底', 'Lẩu riêu cua 蟹汤锅底',
      'Lẩu măng chua 酸笋锅底', 'Lẩu nấm 菌菇锅底', 'Lẩu chua cay 酸辣锅底', 'Lẩu kim chi 泡菜锅底',
      'Lẩu sườn non 排骨锅底', 'Lẩu cua đồng 田蟹锅底', 'Lẩu lươn 鳝鱼锅底', 'Lẩu ốc 田螺锅底',
      'Lẩu vịt om sấu 酸梅鸭锅底', 'Lẩu dê 羊肉锅底', 'Lẩu tôm 虾锅底',
    ],
  },
  'hotpot-vn-ingredients': {
    vi: 'Đồ nhúng lẩu', en: 'Hotpot ingredients (VN)', zh: '越式火锅涮菜', cuisine: 'vn', count: 40,
    examples: [
      'Thịt bò Mỹ 美国肥牛', 'Ba chỉ bò Mỹ 五花肥牛', 'Nạm bò 牛腩', 'Bắp bò 牛腱', 'Đuôi bò 牛尾',
      'Sườn sụn 软骨排骨', 'Thịt gà 鸡肉', 'Cánh gà 鸡翅', 'Mề gà 鸡胗', 'Ba chỉ heo 猪五花',
      'Thịt dê 羊肉', 'Tôm sú 大虾', 'Tôm tít 虾蛄', 'Mực 鱿鱼', 'Bạch tuộc 章鱼', 'Nghêu 蛤蜊',
      'Sò huyết 血蛤', 'Cua 螃蟹', 'Chả cá 鱼饼', 'Đậu phụ 老豆腐', 'Đậu phụ non 嫩豆腐',
      'Đậu hũ ky 腐皮', 'Nấm rơm 草菇', 'Nấm kim châm 金针菇', 'Nấm đùi gà 杏鲍菇', 'Nấm mèo 木耳',
      'Rau muống 空心菜', 'Cải thảo 大白菜', 'Cải ngọt 芥蓝', 'Rau xà lách 生菜', 'Rau tần ô 茼蒿',
      'Khoai môn 芋头', 'Khoai lang 红薯', 'Khoai tây 土豆', 'Ngô 玉米', 'Bún tươi 鲜米粉', 'Miến 粉丝',
      'Trứng gà 鸡蛋', 'Sò điệp 扇贝', 'Ốc hương 香螺',
    ],
  },
  'bbq-vn': {
    vi: 'Nướng', en: 'BBQ & grilled (VN)', zh: '越式烧烤', cuisine: 'vn', count: 40,
    examples: [
      'Thịt ba chỉ nướng 烤五花肉', 'Sườn heo nướng 烤猪排', 'Cánh gà nướng mật ong 蜜汁烤鸡翅',
      'Gà nướng lá chanh 香茅烤鸡', 'Bò cuộn nấm kim châm 牛肉卷金针菇', 'Nem nướng 烤猪肉肠',
      'Nem lụi 烤串', 'Mực nướng sa tế 沙茶烤鱿鱼', 'Tôm nướng muối ớt 椒盐烤虾',
      'Hàu nướng mỡ hành 葱油烤生蚝', 'Sò điệp nướng 烤扇贝', 'Cá lóc nướng trui 竹烤鱼',
      'Bạch tuộc nướng 烤章鱼', 'Ngô nướng 烤玉米', 'Khoai lang nướng 烤红薯', 'Sắn nướng 烤木薯',
      'Bánh mì nướng 烤法棍', 'Trứng vịt lộn nướng 烤毛蛋', 'Lạp xưởng nướng 烤腊肠',
      'Nầm heo nướng sa tế 沙茶烤猪隔膜', 'Chân gà nướng 烤鸡爪', 'Xúc xích nướng 烤香肠',
      'Gầu bò nướng 烤牛胸', 'Sườn sụn nướng mật ong 蜜汁软骨', 'Đùi gà nướng 烤鸡腿',
      'Cá hồi nướng 烤三文鱼', 'Ốc hương nướng 烤香螺',
    ],
  },
  'grilled-fish-vn': {
    vi: 'Cá nướng / Cá giấy', en: 'Grilled fish (VN)', zh: '越式烤鱼/纸包鱼', cuisine: 'vn', count: 40,
    examples: [
      'Cá lóc nướng trui 竹香烤鲈鱼', 'Cá diêu hồng nướng 烤罗非鱼', 'Cá trê nướng 烤鲶鱼',
      'Cá hồi nướng 烤三文鱼', 'Cá basa nướng giấy bạc 锡纸烤巴沙鱼', 'Cá ngừ nướng 烤金枪鱼',
      'Cá thu nướng 烤鲭鱼', 'Cá rô đồng nướng 烤田鱼', 'Cá chép nướng 烤鲤鱼',
      'Cá diêu hồng chiên xù 脆炸罗非鱼', 'Chả cá Nha Trang 芽庄鱼饼', 'Cá trứng nướng 烤鱼籽',
      'Rau sống ăn kèm 生菜拼盘', 'Bún tươi ăn kèm 鲜米粉', 'Bánh tráng nướng 烤米纸',
      'Nước chấm mắm nêm 鱼酱蘸料', 'Rau củ ngâm chua 泡菜萝卜', 'Gỏi xoài ăn kèm 青芒果沙拉',
    ],
  },
  seafood: {
    vi: 'Hải sản', en: 'Seafood (VN)', zh: '越式海鲜', cuisine: 'vn', count: 40,
    examples: [
      'Tôm rang muối 椒盐虾', 'Tôm hấp nước dừa 椰汁蒸虾', 'Tôm nướng muối ớt 椒盐烤虾',
      'Tôm sú nướng 烤大虾', 'Tôm chiên bột 炸虾', 'Cá kho tộ 砂锅焖鱼', 'Cá lóc nướng trui 竹烤鱼',
      'Cá diêu hồng chiên xù 脆炸罗非鱼', 'Cá hồi nướng mật ong 蜜汁烤三文鱼', 'Cá thu sốt cà chua 番茄鲭鱼',
      'Cá bống kho tiêu 黑胡椒鳅鱼', 'Cá ngừ nướng muối ớt 椒盐金枪鱼', 'Mực nướng sa tế 沙茶烤鱿鱼',
      'Mực chiên giòn 香脆炸鱿鱼', 'Bạch tuộc nướng sa tế 沙茶烤章鱼', 'Bạch tuộc xào cay 辣炒章鱼',
      'Ghẹ hấp bia 啤酒蒸蟹', 'Cua rang me 罗望子蟹', 'Sò huyết rang me 罗望子血蛤', 'Sò điệp nướng mỡ hành 葱油烤扇贝',
      'Nghêu hấp sả 香茅蒸蛤蜊', 'Ốc hương xào bơ tỏi 牛油蒜香螺', 'Ốc len xào dừa 椰香螺',
      'Sứa trộn xoài 芒果海蜇', 'Lẩu hải sản 海鲜锅', 'Chả cá thác lác 鱼饼',
    ],
  },
  'fried-snacks': {
    vi: 'Đồ chiên', en: 'Fried snacks', zh: '炸物小吃', cuisine: 'vn', count: 40,
    examples: [
      'Gà rán 炸鸡', 'Khoai tây chiên 炸薯条', 'Khoai lang chiên 炸红薯条', 'Nem rán 炸春卷',
      'Chả giò rế 脆皮炸春卷', 'Đậu phụ chiên giòn 脆炸豆腐', 'Bánh xèo 越式煎饼', 'Bánh khọt 椰浆煎糕',
      'Tôm chiên xù 炸虾', 'Mực chiên bột 炸鱿鱼圈', 'Phồng tôm 虾片', 'Bắp chiên bơ 黄油玉米',
      'Đùi gà chiên 炸鸡腿', 'Cánh gà chiên nước mắm 鱼露炸鸡翅', 'Chả lụa chiên 炸火腿',
    ],
  },
  dessert: {
    vi: 'Tráng miệng / Chè', en: 'Desserts & sweet', zh: '甜品糖水', cuisine: 'vn', count: 40,
    examples: [
      'Chè đậu xanh 绿豆糖水', 'Chè đậu đen 黑豆糖水', 'Chè bắp 玉米糖水', 'Chè khoai môn 芋头糖水',
      'Chè thập cẩm 什锦糖水', 'Chè trôi nước 汤圆糖水', 'Chè bà ba 三宝糖水', 'Chè chuối 香蕉糖水',
      'Chè hạt sen 莲子糖水', 'Chè long nhãn hạt sen 桂圆莲子糖水', 'Chè cốm 糯米糖水',
      'Chè bánh lọt 绿豆粉糕糖水', 'Chè sương sa hạt lựu 冰粉石榴糖水', 'Chè thái 泰式糖水',
      'Chè khúc bạch 杏仁豆腐糖水', 'Chè bưởi 柚子糖水', 'Chè mè đen 黑芝麻糖水', 'Chè trái cây 水果糖水',
      'Chè sầu riêng 榴莲糖水', 'Chè flan 焦糖布丁糖水', 'Chè ba màu 三色糖水', 'Chè hạt é 罗勒籽糖水',
      'Chè khoai tía 紫薯糖水',
    ],
  },
  nhau: {
    vi: 'Đồ nhậu', en: 'Drinking snacks (VN)', zh: '越式下酒菜', cuisine: 'vn', count: 40,
    examples: [
      'Chân gà nướng 烤鸡爪', 'Chân gà ngâm sả tắc 香茅青柠泡鸡爪', 'Mực khô nướng 烤干鱿鱼',
      'Nem chua 发酵猪肉卷', 'Lạc rang muối 盐炒花生', 'Lạc luộc 水煮花生', 'Đậu phụ chiên giòn 脆炸豆腐',
      'Bò tái chanh 柠檬生牛肉沙拉', 'Gỏi ngó sen tôm thịt 莲藕虾仁沙拉', 'Ốc xào sả ớt 香茅辣炒田螺',
      'Ốc hấp tiêu 胡椒蒸田螺', 'Nghêu hấp sả 香茅蒸蛤蜊', 'Khô bò 牛肉干', 'Khô cá lóc 鱼干',
      'Tôm khô rang 炒虾米', 'Lòng xào dưa chua 酸菜炒猪杂', 'Mực trứng xào 炒鱿鱼', 'Trứng vịt lộn 毛蛋',
      'Bánh đa nướng 烤米饼', 'Xoài xanh chấm mắm 青芒果蘸鱼露', 'Mướp đắng chà bông 肉松苦瓜',
      'Rau muống xào tỏi 蒜炒空心菜', 'Thịt trâu gác bếp 烟熏水牛肉', 'Gỏi đu đủ 青木瓜沙拉',
      'Gà rang muối 盐焗鸡', 'Cá khô tẩm bột chiên 炸鱼干',
    ],
  },
  'spring-rolls': {
    vi: 'Gỏi cuốn / Nem', en: 'Spring rolls & rice paper', zh: '春卷/米纸卷', cuisine: 'vn', count: 40,
    examples: [
      'Gỏi cuốn tôm 鲜虾米纸卷', 'Gỏi cuốn bò 牛肉米纸卷', 'Gỏi cuốn chay 素米纸卷',
      'Gỏi cuốn gà 鸡肉米纸卷', 'Gỏi cuốn cá 鱼肉米纸卷', 'Gỏi cuốn tôm thịt 虾肉米纸卷',
      'Gỏi cuốn bò nướng 烤牛肉卷', 'Gỏi cuốn thập cẩm 什锦米纸卷', 'Nem rán 炸春卷', 'Chả giò 炸春卷',
      'Chả giò rế 脆皮炸春卷', 'Nem chua rán 炸发酵肉卷', 'Bánh xèo 越式煎饼', 'Bánh khọt 椰浆糕',
      'Bánh cuốn 蒸卷粉', 'Bánh ướt 湿卷粉', 'Gỏi cuốn nem 肉卷米纸卷', 'Gỏi cuốn chả cá 鱼饼米纸卷',
    ],
  },

  // ================= 中国菜（cuisine=cn，13 类） =================
  'hotpot-cn-base': {
    vi: 'Nồi lẩu TQ', en: 'Hotpot broths (CN)', zh: '中式火锅锅底', cuisine: 'cn', count: 25,
    examples: [
      '四川麻辣牛油锅底', '微辣红油锅底', '中辣火锅锅底', '重辣九宫格锅底', '清油麻辣锅底', '鸳鸯锅底',
      '番茄锅底', '菌汤养生锅底', '菌菇锅底', '酸菜鱼锅底', '猪肚鸡锅底', '三鲜锅底', '清汤锅底',
      '大骨浓汤锅底', '滋补药膳锅底', '冬阴功锅底', '咖喱锅底', '韩式泡菜锅底', '酸汤锅底', '藤椒锅底',
      '金汤酸辣锅底', '寿喜锅底', '豆乳锅底', '海鲜锅底', '萝卜牛腩锅底',
    ],
  },
  'hotpot-cn-meat': {
    vi: 'Thịt lẩu TQ', en: 'Hotpot meats (CN)', zh: '火锅涮肉', cuisine: 'cn', count: 40,
    examples: [
      '肥牛卷', '吊龙（牛里脊）', '吊龙伴', '嫩牛肉', '毛肚', '牛百叶', '牛肚', '牛蹄筋', '牛舌',
      '胸口膀（胸口油）', '羊肉卷', '手切鲜羊肉', '羊上脑', '猪五花肉片', '猪黄喉', '牛黄喉',
      '鸭肠', '鸭血', '鸭掌', '鸡腿肉', '鸡胗', '午餐肉', '嫩鸡肉', '鹌鹑蛋', '腰片', '脑花',
    ],
  },
  'hotpot-cn-balls': {
    vi: 'Viên & hải sản lẩu', en: 'Hotpot balls & seafood (CN)', zh: '火锅丸滑海鲜', cuisine: 'cn', count: 40,
    examples: [
      '潮汕牛肉丸', '撒尿牛丸', '虾滑', '鱼滑', '墨鱼滑', '鱼丸', '墨鱼丸', '花枝丸', '香菇贡丸',
      '猪肉丸', '鸡肉丸', '虾丸', '鱼籽福袋', '蟹肉棒', '蛋饺', '燕饺', '虾味饺', '开花肠', '甜不辣',
      '鱼豆腐', '芝士年糕', '芝士包', '小酥肉', '红糖糍粑', '虾枣',
    ],
  },
  'hotpot-cn-veg': {
    vi: 'Rau & nấm lẩu', en: 'Hotpot vegetables (CN)', zh: '火锅蔬菜菌菇', cuisine: 'cn', count: 40,
    examples: [
      '生菜', '娃娃菜', '菠菜', '茼蒿', '油麦菜', '空心菜', '大白菜', '卷心菜', '豌豆尖', '莴笋叶',
      '香菜', '金针菇', '香菇', '平菇', '杏鲍菇', '海鲜菇', '鸡腿菇', '木耳', '银耳', '竹荪',
      '土豆片', '莲藕', '山药', '白萝卜', '冬瓜', '南瓜', '莴笋', '竹笋', '玉米', '海带', '豆芽',
      '西兰花', '花菜', '红薯', '芋头', '贡菜',
    ],
  },
  'hotpot-cn-staple': {
    vi: 'Đậu & mì lẩu', en: 'Hotpot tofu & staples (CN)', zh: '火锅豆制品主食', cuisine: 'cn', count: 40,
    examples: [
      '老豆腐', '嫩豆腐', '冻豆腐', '千页豆腐', '日本豆腐', '油豆腐', '豆腐皮', '千张', '腐竹',
      '响铃卷', '豆泡', '兰花干', '素鸡', '鸡蛋干', '魔芋丝', '魔芋结', '宽粉', '红薯粉', '粉丝',
      '土豆粉', '年糕', '手擀面', '乌冬面', '方便面', '苕皮', '火锅面', '葱花饼', '小馒头',
    ],
  },
  'bbq-cn': {
    vi: 'Nướng TQ', en: 'BBQ (CN)', zh: '中式烧烤', cuisine: 'cn', count: 40,
    examples: [
      '羊肉串', '烤羊排', '烤羊腰', '牛肉串', '烤五花肉串', '烤肥肠', '烤鸡翅', '奥尔良烤鸡翅',
      '蜜汁烤翅', '烤鸡腿', '烤鸡胗', '烤鸡心', '烤鸡脖', '烤鸡爪', '烤脆骨', '烤板筋', '烤猪蹄',
      '烤韭菜', '烤茄子', '烤金针菇', '烤香菇', '烤土豆片', '烤豆角', '烤玉米', '烤面包片',
      '烤馒头片', '烤面筋', '烤生蚝', '蒜蓉烤生蚝', '烤扇贝', '烤大虾', '烤鱿鱼', '烤黄花鱼',
      '锡纸金针菇', '锡纸花甲', '煮花生', '煮毛豆',
    ],
  },
  'grilled-fish-cn': {
    vi: 'Cá nướng TQ', en: 'Grilled fish (CN)', zh: '中式烤鱼/纸包鱼', cuisine: 'cn', count: 40,
    examples: [
      '万州烤鱼', '重庆麻辣烤鱼', '香辣烤鱼', '蒜香烤鱼', '豆豉烤鱼', '酸菜烤鱼', '剁椒烤鱼',
      '藤椒烤鱼', '麻辣纸包鱼', '蒜蓉纸包鱼', '咖喱纸包鱼', '泡椒纸包鱼', '锡纸烤鱼', '清江鱼',
      '黑鱼烤鱼', '草鱼烤鱼', '巴沙鱼烤鱼', '鲈鱼烤鱼', '烤鱼配菜-土豆片', '烤鱼配菜-藕片',
      '烤鱼配菜-宽粉', '烤鱼配菜-千页豆腐', '烤鱼配菜-金针菇', '烤鱼配菜-洋葱', '烤鱼配菜-豆芽',
      '烤鱼配菜-腐竹', '烤鱼配菜-魔芋', '烤鱼配菜-鱼豆腐', '烤鱼配菜-青菜',
    ],
  },
  'stir-fry-cn': {
    vi: 'Xào TQ', en: 'Stir-fry (CN)', zh: '中餐炒菜', cuisine: 'cn', count: 40,
    examples: [
      '麻婆豆腐', '宫保鸡丁', '回锅肉', '鱼香肉丝', '酸辣土豆丝', '番茄炒蛋', '青椒肉丝',
      '蒜蓉西兰花', '干煸四季豆', '红烧肉', '糖醋里脊', '水煮肉片', '辣子鸡', '干锅花菜',
      '蒜香排骨', '红烧茄子', '鱼香茄子', '地三鲜', '农家小炒肉', '辣椒炒肉', '韭菜炒鸡蛋',
      '木须肉', '京酱肉丝', '糖醋排骨', '红烧狮子头', '可乐鸡翅', '黄焖鸡', '虎皮青椒',
      '干煸豆角', '蚂蚁上树',
    ],
  },
  'seafood-cn': {
    vi: 'Hải sản TQ', en: 'Seafood (CN)', zh: '中式海鲜', cuisine: 'cn', count: 40,
    examples: [
      '麻辣小龙虾', '蒜蓉小龙虾', '十三香小龙虾', '蒜蓉粉丝蒸扇贝', '清蒸鲈鱼', '清蒸石斑鱼',
      '红烧大虾', '椒盐皮皮虾', '香辣蟹', '清蒸大闸蟹', '辣炒花蛤', '爆炒鱿鱼', '姜葱炒蟹',
      '避风塘炒虾', '蒜蓉生蚝', '香辣炒蛏子', '剁椒鱼头', '糖醋鱼', '清蒸带鱼', '红烧带鱼',
      '白灼虾', '蒜蓉开背虾', '麻辣田螺', '辣炒蛤蜊', '铁板鱿鱼', '孜然鱿鱼须', '椒盐小黄鱼',
    ],
  },
  'cold-dishes': {
    vi: 'Món nguội TQ', en: 'Cold dishes & snacks (CN)', zh: '中式凉菜/下酒菜', cuisine: 'cn', count: 40,
    examples: [
      '拍黄瓜', '凉拌木耳', '凉拌腐竹', '凉拌海蜇', '酱牛肉', '卤味拼盘', '口水鸡', '夫妻肺片',
      '蒜泥白肉', '白切鸡', '皮蛋豆腐', '老醋花生', '泡椒凤爪', '麻辣兔头', '凉拌猪耳',
      '凉拌猪头肉', '凉拌豆干', '凉拌三丝', '凉拌折耳根', '酸辣黄瓜条', '凉拌藕片', '凉拌土豆丝',
      '花生米', '煮毛豆', '红油耳丝', '凉拌海带丝', '凉拌金针菇', '卤鸭脖', '卤鸡爪', '酱鸭',
      '凉拌西红柿', '蒜香豆角', '盐水鸭', '卤牛肉', '辣白菜', '凉拌莴笋丝',
    ],
  },
  'rice-cn': {
    vi: 'Cơm & mì TQ', en: 'Rice & noodles (CN)', zh: '中式主食', cuisine: 'cn', count: 40,
    examples: [
      '扬州炒饭', '蛋炒饭', '酱油炒饭', '牛肉炒饭', '番茄鸡蛋盖饭', '鱼香肉丝盖饭', '宫保鸡丁盖饭',
      '麻婆豆腐盖饭', '红烧牛肉面', '兰州拉面', '热干面', '炸酱面', '阳春面', '葱油拌面', '担担面',
      '炒面', '炒河粉', '炒米粉', '猪肉白菜饺子', '韭菜鸡蛋饺子', '蒸饺', '馄饨', '小笼包',
      '肉包', '菜包', '葱油饼', '手抓饼', '煎饼果子', '馒头', '花卷', '油条', '烧饼', '刀削面',
      '凉皮', '肉夹馍',
    ],
  },
  'chuan-chuan': {
    vi: 'Xiên nướng / Tứ Xuyên cay', en: 'Skewers & mala (CN)', zh: '串串/麻辣烫', cuisine: 'cn', count: 40,
    examples: [
      '麻辣烫', '番茄麻辣烫', '骨汤麻辣烫', '串串香', '冷锅串串', '热锅串串', '冒菜', '冒鸭血',
      '冒脑花', '钵钵鸡', '冷吃串串', '麻辣香锅', '酸辣粉', '麻辣拌', '冒土豆', '冒花甲', '冒牛百叶',
      '麻辣烫-牛肉', '麻辣烫-丸子', '麻辣烫-蔬菜', '麻辣烫-粉丝', '藤椒串串',
    ],
  },
  'dry-pot': {
    vi: 'Nồi đá / sắt / đất TQ', en: 'Dry pot & clay pot (CN)', zh: '干锅/铁板/砂锅', cuisine: 'cn', count: 40,
    examples: [
      '干锅肥肠', '干锅虾', '干锅鸡', '干锅花菜', '干锅土豆片', '干锅豆腐', '干锅包菜',
      '干锅茶树菇', '干锅牛蛙', '干锅肥牛', '铁板牛肉', '铁板鱿鱼', '铁板豆腐', '铁板虾',
      '铁板牛柳', '砂锅豆腐', '砂锅鱼头', '砂锅鸡', '砂锅排骨', '砂锅粥', '砂锅粉丝', '石锅拌饭',
      '石锅鱼', '石锅豆腐', '瓦罐汤', '煲仔饭',
    ],
  },

  // ================= 酒水饮品（cuisine=drink，9 类，真实品牌+中性图+规格） =================
  coffee: {
    vi: 'Cà phê', en: 'Coffee', zh: '咖啡', cuisine: 'drink', count: 40,
    examples: [
      'Cà phê sữa đá 冰奶咖啡', 'Cà phê đen đá 冰黑咖啡', 'Cà phê sữa nóng 热奶咖啡',
      'Bạc xỉu 咖啡牛奶', 'Cà phê trứng 蛋咖啡', 'Espresso', 'Americano', 'Cappuccino', 'Latte',
      'Mocha', 'Flat white', 'Cold brew', '生椰拿铁', '冰美式', '焦糖玛奇朵', '燕麦拿铁',
      '桂花拿铁', '澳白', '手冲咖啡', 'Cà phê cốt dừa 椰奶咖啡',
    ],
  },
  'milk-tea': {
    vi: 'Trà sữa', en: 'Milk tea', zh: '奶茶', cuisine: 'drink', count: 40,
    examples: [
      'Trà sữa trân châu 珍珠奶茶', 'Trà sữa khoai môn 芋头奶茶', 'Trà sữa matcha 抹茶奶茶',
      'Trà sữa ô long 乌龙奶茶', 'Trà sữa socola 巧克力奶茶', '波霸奶茶', '黑糖珍珠鲜奶',
      '芝士奶盖茶', '杨枝甘露', '芋泥啵啵', '烧仙草', '满杯水果茶', '柠檬茶', '椰椰奶茶',
      '布丁奶茶', '红豆奶茶', '仙草冻奶茶', 'Trà sữa sầu riêng 榴莲奶茶',
    ],
  },
  beer: {
    vi: 'Bia', en: 'Beer', zh: '啤酒', cuisine: 'drink', count: 40, optionGroups: SPEC.beer,
    examples: [
      'Bia Saigon Export 西贡出口啤酒', 'Bia Saigon Special 西贡特制啤酒', 'Bia Saigon Lager 西贡淡啤',
      'Bia 333', 'Bia Hà Nội 河内啤酒', 'Bia Trúc Bạch 竹白啤酒', 'Bia Tiger 虎牌啤酒',
      'Tiger Crystal 虎牌晶纯', 'Heineken 喜力', 'Bia Larue 拉鲁啤酒', 'Bia Huda 皇达啤酒',
      '青岛啤酒', '青岛纯生', '雪花啤酒', '哈尔滨啤酒', '燕京啤酒', '崂山啤酒', 'Corona 科罗娜',
      'Budweiser 百威', '1664', 'Guinness 健力士', 'Sapporo 札幌', 'Asahi 朝日', 'Hoegaarden 福佳白',
      'Bia thủ công 精酿啤酒', 'Bia không cồn 无醇啤酒',
    ],
  },
  'soft-drinks': {
    vi: 'Nước ngọt', en: 'Soft drinks', zh: '碳酸/功能饮料', cuisine: 'drink', count: 40, optionGroups: SPEC.softDrink,
    examples: [
      'Coca-Cola 可口可乐', 'Coca-Cola Zero 零度可乐', 'Sprite 雪碧', 'Fanta 芬达', 'Pepsi 百事可乐',
      '7Up 七喜', 'Mirinda 美年达', '红牛', '东鹏特饮', 'Sting', 'Sting dâu 草莓味Sting',
      'Number One', 'Dr.Thanh 中草药凉茶', '康师傅冰红茶', '康师傅冰绿茶', '沙示汽水',
      'Nước xá xị 西贡汽水',
    ],
  },
  juice: {
    vi: 'Nước ép', en: 'Juice', zh: '果汁', cuisine: 'drink', count: 40,
    examples: [
      'Nước ép xoài 芒果汁', 'Nước ép dưa hấu 西瓜汁', 'Nước ép cam 橙汁', 'Nước ép cà chua 番茄汁',
      'Nước ép ổi 番石榴汁', 'Nước ép thơm 菠萝汁', 'Nước ép lựu 石榴汁', 'Nước dừa 椰子水',
      'Nước bí đao 冬瓜茶', 'Nước mía 甘蔗汁', 'Nước ép cần tây 芹菜汁', 'Nước ép chanh dây 百香果汁',
      'Sagiko 百香果', 'Sagiko 芒果', 'Sagiko 荔枝', 'Vfresh 橙汁', 'Nước ép dâu 草莓汁',
    ],
  },
  tea: {
    vi: 'Trà', en: 'Tea & herbal drinks', zh: '茶饮/凉茶', cuisine: 'drink', count: 40,
    examples: [
      'Trà đá 冰茶', 'Trà chanh 柠檬茶', 'Trà atiso 朝鲜蓟茶', 'Trà gừng 姜茶', 'Trà xanh 绿茶',
      'Trà lài 茉莉花茶', '冰红茶', '冰绿茶', '柠檬茶', '王老吉', '加多宝', '东方树叶', '茶π',
      '茉莉蜜茶', '菊花茶', '大麦茶', '薄荷茶', '普洱', 'Trà mạn 功夫茶',
    ],
  },
  smoothie: {
    vi: 'Sinh tố', en: 'Smoothie & shake', zh: '冰沙/奶昔', cuisine: 'drink', count: 40,
    examples: [
      'Sinh tố xoài 芒果冰沙', 'Sinh tố dừa 椰奶冰沙', 'Sinh tố bơ 牛油果奶昔', 'Sinh tố mãng cầu 释迦冰沙',
      'Sinh tố dâu 草莓奶昔', 'Sinh tố mít 菠萝蜜冰沙', 'Sinh tố sầu riêng 榴莲冰沙',
      'Sinh tố ổi 番石榴冰沙', 'Sinh tố bắp 玉米冰沙', '芒果冰沙', '西瓜冰沙', '红豆冰沙',
      '杨枝甘露', '抹茶冰沙', '可可冰沙', '咖啡冰沙', '芋头冰沙',
    ],
  },
  alcohol: {
    vi: 'Rượu', en: 'Spirits & baijiu', zh: '烈酒/白酒', cuisine: 'drink', count: 25, optionGroups: SPEC.alcohol,
    examples: [
      '茅台', '五粮液', '剑南春', '泸州老窖', '汾酒', '二锅头', '江小白', '洋河大曲', '杜康',
      '威士忌 Johnnie Walker', '威士忌 Jack Daniels', '伏特加 Smirnoff', '白兰地', '轩尼诗',
      '朗姆酒', '龙舌兰', '梅子酒', '韩国烧酒 真露', '日本清酒 獭祭', '国窖1573', '竹叶青',
    ],
  },
  water: {
    vi: 'Nước suối', en: 'Water & coconut', zh: '矿泉水/椰汁', cuisine: 'drink', count: 15, optionGroups: SPEC.water,
    examples: [
      'Nước suối 瓶装矿泉水', 'Aquafina 纯水乐', 'Dasani', '崂山矿泉水', '农夫山泉', '怡宝',
      '椰汁', '椰树椰汁', '芦荟汁', '椰子水 Wana', '气泡水', '苏打水', '0卡气泡水', '盐汽水',
      '果珍',
    ],
  },
  'cn-drinks': {
    vi: 'Nước uống TQ', en: 'Drinks (CN)', zh: '中国酒水饮品', cuisine: 'drink', count: 25, optionGroups: SPEC.cnDrinks,
    examples: [
      '王老吉凉茶', '加多宝凉茶', '北冰洋汽水', '健力宝', '椰树椰汁', '酸梅汤',
      '青岛啤酒', '雪花啤酒', '哈尔滨啤酒', '燕京啤酒', '红星二锅头', '江小白', '汾酒', '竹叶青',
      '康师傅冰红茶', '统一绿茶', '红牛', '东鹏特饮', '娃哈哈AD钙奶', '银鹭花生牛奶', '六个核桃', '农夫山泉', '尖叫', '水溶C100',
    ],
  },
}

export const DEFAULT_PRICE_HINT = '根据越南当地街头/小店价，范围 15,000 - 120,000 VND，按整千取值'

// 批量生成菜品 system prompt；cuisine 决定菜系规则
// vn=纯越南菜 / cn=中国菜（越南语菜名+中文原名+越南语描述，VN 市场习惯）/ drink=真实品牌+中性图prompt
export function buildDishSystemPrompt(cuisine: Cuisine): string {
  const rule =
    cuisine === 'vn'
      ? '- 菜名用真实常见的越南本地菜（不是编造品），数量、食材、口味贴近当地。'
      : cuisine === 'cn'
        ? `- 这是**中国菜**子分类。中国菜一律用**越南语菜名**（越南人熟悉的叫法，如 Cơm chiên Dương Châu=扬州炒饭、Lẩu Tứ Xuyên=四川火锅、Đậu phụ Mapo=麻婆豆腐），name_zh 写中文原名，description_local 用越南语。`
        : `- 这是**酒水饮品**子分类。**使用真实品牌名**（如 Bia Saigon、Tiger、Heineken、Coca-Cola、红牛、王老吉、青岛啤酒等），nativeName 用越南语拼写，name_zh 用中文品牌名。
- imagePrompt 一律用**中性描述**：只描述容器与饮品外观（如 red cola can with white swoosh / amber beer glass bottle with ice / herbal tea can），**禁止出现任何品牌字样、商标文字、logo、水印、字幕**。`
  const label = cuisine === 'vn' ? '越南菜' : cuisine === 'cn' ? '中国菜' : '酒水饮品'
  return `你是越南餐饮菜单专家。为一个越南餐厅的「${label}」子分类生成菜品菜单数据。
要求：
${rule}
- 每道菜必须且只能有这些字段（JSON 键名严格如下，一个都不能少，不能改名/换名/嵌套）：
  nativeName（越南语菜名）、name_en（英文译名）、name_zh（中文译名）、
  description_local（越南语描述 1-2 句）、description_zh（中文描述 1-2 句，忠实翻译 description_local）、description_en（英文描述）、
  unit（计量单位越南语，如 tô/phần/cái/lon/kg；按份卖无特殊单位就写 phần，不要省略）、unit_zh（计量单位中文，与 unit 对应，如 碗/份/个/罐/公斤）、
  defaultPrice（VND 整数）、extras（越南语加料数组，最多 4 个，无则 []）、extras_zh（中文加料数组，**与 extras 一一对应顺序相同**，无则 []）、
  allergens（过敏原数组，如 花生/甲壳类/麸质/大豆，无则 []）、
  dietaryTags（只能从 [halal, vegetarian, spicy, gluten-free] 中选，无则 []）、
  imagePrompt（英文写实食物摄影描述，含光线/场景/摆盘）。
- 禁止用 name 代替 nativeName，禁止新增 name 字段。
- defaultPrice 是 VND 整数。${DEFAULT_PRICE_HINT}
- 只输出一个 JSON 对象：{"dishes": [ {...}, ... ]}，不要 markdown 代码块。`
}

// 批量生成 user prompt；meta=子分类元数据（静态 FOOD_SUBCATEGORIES 或 Admin 新增的 PresetCategory，第 20 批改接 meta 对象）
// examples=维度指引（多方位不孤立），existingNames=已有菜名（top-up 去重用）
export function buildDishUserPrompt(meta: SubcategoryMeta, count: number, existingNames: string[] = []): string {
  const dimRule =
    meta.examples.length > 0
      ? `\n覆盖方向（务必"多方位"铺满，参考但不限于）：${meta.examples.join('、')}`
      : ''
  const dupRule = existingNames.length > 0 ? `\n**不要与以下已有菜品重复**：${existingNames.join('、')}` : ''
  return `子分类：${meta.vi}（${meta.zh} / ${meta.en}）
生成 ${count} 道该子分类下最常见/最真实的菜品（可含招牌/经典款），各菜之间菜名与食材不要重复。${dimRule}${dupRule}`
}

// 文生图 prompt（写实食物摄影风格统一前缀，A3 出图用）
export function buildImagePrompt(dishNameVi: string, dishNameEn: string, basePrompt: string): string {
  return `Professional food photography, ${basePrompt} (${dishNameEn}), on a rustic wooden table in a cozy Vietnamese restaurant, warm natural light, shallow depth of field, appetizing, no text, no words, no watermark, square 1:1`
}
