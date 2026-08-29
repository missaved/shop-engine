-- CreateTable
CREATE TABLE "PresetCategory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameVi" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "cuisine" TEXT NOT NULL DEFAULT 'vn',
    "count" INTEGER NOT NULL DEFAULT 40,
    "examples" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PresetCategory_key_key" ON "PresetCategory"("key");

