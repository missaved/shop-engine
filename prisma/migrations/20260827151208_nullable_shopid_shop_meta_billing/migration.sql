-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'VND',
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "platformSuspended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subscribedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "shopId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Billing" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "months" INTEGER,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Billing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Billing_shopId_createdAt_idx" ON "Billing"("shopId", "createdAt");

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
