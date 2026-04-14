-- ============================================================
-- Migration: 20260415090000_location_nodes
-- Post-deploy step (run ONCE after migration):
--   pnpm db:backfill
-- This resolves existing address and service-area rows to the
-- new location taxonomy. Safe to re-run (idempotent).
-- ============================================================

-- Add REGION to the TechnicianServiceAreaType enum
ALTER TYPE "TechnicianServiceAreaType" ADD VALUE IF NOT EXISTS 'REGION';

-- Create LocationNodeType enum
CREATE TYPE "LocationNodeType" AS ENUM ('PROVINCE', 'CITY', 'REGION', 'SUBURB');

-- Create location_nodes table
CREATE TABLE "location_nodes" (
    "id" TEXT NOT NULL,
    "nodeType" "LocationNodeType" NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "radiusKm" DOUBLE PRECISION,
    "provinceKey" TEXT,
    "cityKey" TEXT,
    "regionKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_nodes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "location_nodes_slug_key" ON "location_nodes"("slug");
CREATE INDEX "location_nodes_nodeType_active_idx" ON "location_nodes"("nodeType", "active");
CREATE INDEX "location_nodes_provinceKey_nodeType_idx" ON "location_nodes"("provinceKey", "nodeType");
CREATE INDEX "location_nodes_cityKey_nodeType_idx" ON "location_nodes"("cityKey", "nodeType");
CREATE INDEX "location_nodes_regionKey_idx" ON "location_nodes"("regionKey");

ALTER TABLE "location_nodes" ADD CONSTRAINT "location_nodes_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add locationNodeId to addresses
ALTER TABLE "addresses" ADD COLUMN "locationNodeId" TEXT;
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_locationNodeId_fkey"
  FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add structured columns to technician_service_areas
ALTER TABLE "technician_service_areas" ADD COLUMN "locationNodeId" TEXT;
ALTER TABLE "technician_service_areas" ADD COLUMN "cityKey" TEXT;
ALTER TABLE "technician_service_areas" ADD COLUMN "regionKey" TEXT;
ALTER TABLE "technician_service_areas" ADD COLUMN "suburbKey" TEXT;
ALTER TABLE "technician_service_areas" ADD CONSTRAINT "technician_service_areas_locationNodeId_fkey"
  FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "technician_service_areas_locationNodeId_idx" ON "technician_service_areas"("locationNodeId");
