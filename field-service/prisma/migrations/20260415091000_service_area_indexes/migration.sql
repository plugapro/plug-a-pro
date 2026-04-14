-- Migration: 20260415091000_service_area_indexes
-- Adds missing indexes and provinceKey column to technician_service_areas
-- and adds locationNodeId index to addresses.

-- Add provinceKey to technician_service_areas
ALTER TABLE "technician_service_areas" ADD COLUMN IF NOT EXISTS "provinceKey" TEXT;

-- Add indexes
CREATE INDEX IF NOT EXISTS "technician_service_areas_provinceKey_idx" ON "technician_service_areas"("provinceKey");
CREATE INDEX IF NOT EXISTS "technician_service_areas_suburbKey_idx" ON "technician_service_areas"("suburbKey");
CREATE INDEX IF NOT EXISTS "addresses_locationNodeId_idx" ON "addresses"("locationNodeId");

-- Update the regionKey index on location_nodes to include nodeType
DROP INDEX IF EXISTS "location_nodes_regionKey_idx";
CREATE INDEX "location_nodes_regionKey_nodeType_idx" ON "location_nodes"("regionKey", "nodeType");
