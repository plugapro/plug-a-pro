-- Deduplication step (safe no-op if no duplicates exist):
-- Remove any duplicate (shortlistId, providerId) rows keeping the one with the lowest rank.
DELETE FROM "provider_shortlist_items" psi
WHERE EXISTS (
  SELECT 1 FROM "provider_shortlist_items" psi2
  WHERE psi2."shortlistId" = psi."shortlistId"
    AND psi2."providerId" = psi."providerId"
    AND psi2."rank" < psi."rank"
);

-- Add unique constraint
CREATE UNIQUE INDEX "provider_shortlist_items_shortlistId_providerId_key"
  ON "provider_shortlist_items"("shortlistId", "providerId");
