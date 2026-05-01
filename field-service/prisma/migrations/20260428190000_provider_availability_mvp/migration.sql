-- Provider availability MVP fields.
-- Keeps Provider.availableNow as the hot-path lead gate, while storing richer
-- mode/pause/emergency metadata on technician_availability.

ALTER TABLE "technician_availability"
  ADD COLUMN "availabilityMode" TEXT NOT NULL DEFAULT 'ALWAYS_AVAILABLE',
  ADD COLUMN "pausedAt" TIMESTAMP(3),
  ADD COLUMN "pauseReason" TEXT,
  ADD COLUMN "emergencyAvailable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sameDayAvailable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastUpdatedBy" TEXT,
  ADD COLUMN "lastUpdatedChannel" TEXT;

CREATE INDEX "technician_availability_availabilityMode_idx"
  ON "technician_availability"("availabilityMode");
