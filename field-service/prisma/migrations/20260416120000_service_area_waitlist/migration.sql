-- CreateTable
CREATE TABLE "service_area_waitlist" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "category" TEXT,
    "suburb" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_area_waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_area_waitlist_phone_city_key" ON "service_area_waitlist"("phone", "city");

-- CreateIndex
CREATE INDEX "service_area_waitlist_city_idx" ON "service_area_waitlist"("city");
