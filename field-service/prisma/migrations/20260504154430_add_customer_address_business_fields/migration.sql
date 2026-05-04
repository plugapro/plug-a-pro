-- M1-T1: Add CustomerAddress model + Customer business fields + JobRequest.customerAddressId

-- 1. New customer_addresses table
CREATE TABLE "customer_addresses" (
    "id"             TEXT NOT NULL,
    "customerId"     TEXT NOT NULL,
    "label"          TEXT NOT NULL,
    "street"         TEXT NOT NULL,
    "suburb"         TEXT NOT NULL,
    "city"           TEXT NOT NULL,
    "province"       TEXT NOT NULL,
    "postalCode"     TEXT,
    "lat"            DOUBLE PRECISION,
    "lng"            DOUBLE PRECISION,
    "locationNodeId" TEXT,
    "isDefault"      BOOLEAN NOT NULL DEFAULT false,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- 2. FK: customer_addresses → customers
ALTER TABLE "customer_addresses"
    ADD CONSTRAINT "customer_addresses_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. FK: customer_addresses → location_nodes (nullable)
-- Added conditionally: location_nodes may not exist in all DB environments
-- (e.g., databases that pre-date the location_nodes migration).
-- When the table exists the FK is enforced; when it doesn't the column
-- remains a plain nullable TEXT field until the location_nodes migration runs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'location_nodes'
  ) THEN
    ALTER TABLE "customer_addresses"
      ADD CONSTRAINT "customer_addresses_locationNodeId_fkey"
      FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Add business fields to customers
ALTER TABLE "customers"
    ADD COLUMN IF NOT EXISTS "isBusinessAccount" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "businessName" TEXT;

-- 5. Add customerAddressId to job_requests (raw FK field, no relation declared yet)
ALTER TABLE "job_requests"
    ADD COLUMN IF NOT EXISTS "customerAddressId" TEXT;
