-- 第 20 批：FoodPreset 加 cuisine 菜系维度（中越拆分）
-- DropIndex
DROP INDEX "FoodPreset_country_subcategory_active_idx";

-- DropIndex
DROP INDEX "FoodPreset_country_subcategory_key";

-- AlterTable
ALTER TABLE "FoodPreset" ADD COLUMN     "cuisine" TEXT NOT NULL DEFAULT 'vn';

-- CreateIndex
CREATE INDEX "FoodPreset_country_cuisine_subcategory_active_idx" ON "FoodPreset"("country", "cuisine", "subcategory", "active");

-- CreateIndex
CREATE UNIQUE INDEX "FoodPreset_country_cuisine_subcategory_key" ON "FoodPreset"("country", "cuisine", "subcategory");
