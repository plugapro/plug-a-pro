-- ─── Customer lifecycle fields ──────────────────────────────────────────────

ALTER TABLE "customers"
ADD COLUMN "purgeAfter" TIMESTAMP(3),
ADD COLUMN "mergedIntoCustomerId" TEXT;

ALTER TABLE "customers"
ADD CONSTRAINT "customers_mergedIntoCustomerId_fkey"
FOREIGN KEY ("mergedIntoCustomerId") REFERENCES "customers"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Category configuration tables ──────────────────────────────────────────

CREATE TABLE "categories" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "bookingOnAssignment" BOOLEAN NOT NULL DEFAULT false,
  "regulated" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE INDEX "categories_active_sortOrder_idx" ON "categories"("active", "sortOrder");

CREATE TABLE "category_required_certifications" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "category_required_certifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "category_required_certifications_categoryId_code_key"
ON "category_required_certifications"("categoryId", "code");
CREATE INDEX "category_required_certifications_code_idx"
ON "category_required_certifications"("code");

ALTER TABLE "category_required_certifications"
ADD CONSTRAINT "category_required_certifications_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "category_required_equipment" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "category_required_equipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "category_required_equipment_categoryId_tag_key"
ON "category_required_equipment"("categoryId", "tag");
CREATE INDEX "category_required_equipment_tag_idx"
ON "category_required_equipment"("tag");

ALTER TABLE "category_required_equipment"
ADD CONSTRAINT "category_required_equipment_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "category_required_vehicle_types" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "vehicleType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "category_required_vehicle_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "category_required_vehicle_types_categoryId_vehicleType_key"
ON "category_required_vehicle_types"("categoryId", "vehicleType");
CREATE INDEX "category_required_vehicle_types_vehicleType_idx"
ON "category_required_vehicle_types"("vehicleType");

ALTER TABLE "category_required_vehicle_types"
ADD CONSTRAINT "category_required_vehicle_types_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Customer merge audit ───────────────────────────────────────────────────

CREATE TABLE "customer_merge_events" (
  "id" TEXT NOT NULL,
  "sourceCustomerId" TEXT,
  "targetCustomerId" TEXT,
  "executedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customer_merge_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_merge_events_sourceCustomerId_createdAt_idx"
ON "customer_merge_events"("sourceCustomerId", "createdAt");
CREATE INDEX "customer_merge_events_targetCustomerId_createdAt_idx"
ON "customer_merge_events"("targetCustomerId", "createdAt");

ALTER TABLE "customer_merge_events"
ADD CONSTRAINT "customer_merge_events_sourceCustomerId_fkey"
FOREIGN KEY ("sourceCustomerId") REFERENCES "customers"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_merge_events"
ADD CONSTRAINT "customer_merge_events_targetCustomerId_fkey"
FOREIGN KEY ("targetCustomerId") REFERENCES "customers"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Provider strike ledger fields ──────────────────────────────────────────

ALTER TABLE "provider_notes"
ADD COLUMN "reasonCode" TEXT,
ADD COLUMN "strikeDelta" INTEGER NOT NULL DEFAULT 0;
