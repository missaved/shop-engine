-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "mileage" INTEGER,
    "ownerName" TEXT,
    "ownerPhone" TEXT,
    "notes" TEXT,
    "lastServiceAt" TIMESTAMP(3),
    "nextServiceKm" INTEGER,
    "nextServiceDue" TIMESTAMP(3),
    "lastIntervalDays" INTEGER,
    "ownerCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotoPreset" (
    "id" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "nameVi" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "defaultPrice" DECIMAL(12,2) NOT NULL,
    "unit" TEXT,
    "category" TEXT NOT NULL,
    "maintenanceType" TEXT NOT NULL,
    "intervalKm" INTEGER,
    "intervalDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotoPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vehicle_shopId_ownerPhone_idx" ON "Vehicle"("shopId", "ownerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_shopId_plate_key" ON "Vehicle"("shopId", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "MotoPreset_serviceKey_key" ON "MotoPreset"("serviceKey");

-- CreateIndex
CREATE INDEX "MotoPreset_category_active_idx" ON "MotoPreset"("category", "active");

-- CreateIndex
CREATE INDEX "MotoPreset_maintenanceType_active_idx" ON "MotoPreset"("maintenanceType", "active");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
