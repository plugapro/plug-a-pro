ALTER TABLE "matches"
  ADD COLUMN "customerContactedAt" TIMESTAMP(3),
  ADD COLUMN "plannedArrivalStart" TIMESTAMP(3),
  ADD COLUMN "plannedArrivalEnd" TIMESTAMP(3),
  ADD COLUMN "plannedArrivalNote" TEXT,
  ADD COLUMN "providerOnTheWayAt" TIMESTAMP(3),
  ADD COLUMN "providerArrivedAt" TIMESTAMP(3),
  ADD COLUMN "providerStartedAt" TIMESTAMP(3),
  ADD COLUMN "providerCompletedAt" TIMESTAMP(3);
