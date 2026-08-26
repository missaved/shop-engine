-- 订单核心：对外订单号 displayNo + 实收 paidAmount（替换 paid 布尔）

-- 1. 加 displayNo（先可空，回填后再设 NOT NULL）
ALTER TABLE "Order" ADD COLUMN "displayNo" TEXT;

-- 2. 回填现有订单：CP-YYMMDD-NNN（NNN 取店内自增 orderNo）
UPDATE "Order"
SET "displayNo" = 'CP-' || to_char("createdAt", 'YYMMDD') || '-' || lpad("orderNo"::text, 3, '0');

-- 3. displayNo 设 NOT NULL
ALTER TABLE "Order" ALTER COLUMN "displayNo" SET NOT NULL;

-- 4. 加 paidAmount（实收，默认 0）
ALTER TABLE "Order" ADD COLUMN "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 5. 回填已收款订单：实收 = 合计
UPDATE "Order" SET "paidAmount" = "total" WHERE "paid" = true;

-- 6. 删 paid 布尔列
ALTER TABLE "Order" DROP COLUMN "paid";

-- 7. 唯一约束（店内 displayNo 唯一）
CREATE UNIQUE INDEX "Order_shopId_displayNo_key" ON "Order"("shopId", "displayNo");
