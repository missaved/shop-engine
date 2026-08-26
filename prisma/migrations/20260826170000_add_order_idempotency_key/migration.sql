-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_shopId_idempotencyKey_key" ON "Order"("shopId", "idempotencyKey");
