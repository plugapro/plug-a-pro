-- Persist resolved LocationNode ids on provider applications so every
-- approval-time path can provision matchability (TSA rows) without
-- re-resolving free-text serviceAreas labels. Additive only. [PJ-01]
ALTER TABLE "public"."provider_applications"
  ADD COLUMN "locationNodeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
