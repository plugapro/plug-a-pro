-- Add unique constraint: one TechnicianServiceArea row per provider per LocationNode
-- This enables safe upsert for structured service area rows.
ALTER TABLE "technician_service_areas"
  ADD CONSTRAINT "technician_service_areas_providerId_locationNodeId_key"
  UNIQUE ("providerId", "locationNodeId");
