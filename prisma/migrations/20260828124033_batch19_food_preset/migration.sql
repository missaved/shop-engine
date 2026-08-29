-- 第 19 批 A1：FoodPreset（预生成菜品模板，一次生成跨店复用）+ ShopDraft（开店引导草稿，替代 Shop.config.draftMenu）
-- 依据：plans/08-ai-onboarding.md §三 + TASK_PLAN 第 19 批 4.1 / 9.1

-- CreateTable FoodPreset
CREATE TABLE "FoodPreset" (
    "id" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL DEFAULT 'FOOD',
    "subcategory" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'vi',
    "country" TEXT NOT NULL DEFAULT 'VN',
    "items" JSONB NOT NULL,
    "promptVersion" TEXT,
    "modelUsed" TEXT,
    "priceSource" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FoodPreset_country_subcategory_key" ON "FoodPreset"("country", "subcategory");
CREATE INDEX "FoodPreset_country_subcategory_active_idx" ON "FoodPreset"("country", "subcategory", "active");

-- CreateTable ShopDraft
CREATE TABLE "ShopDraft" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "presetId" TEXT,
    "items" JSONB NOT NULL,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopDraft_shopId_key" ON "ShopDraft"("shopId");

-- AddForeignKey
ALTER TABLE "ShopDraft" ADD CONSTRAINT "ShopDraft_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
