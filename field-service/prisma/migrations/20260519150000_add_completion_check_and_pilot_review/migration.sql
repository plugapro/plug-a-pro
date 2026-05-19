-- CreateEnum
CREATE TYPE "CompletionCheckStatus" AS ENUM ('SENT', 'YES', 'NO_RESCHEDULED', 'NO_NOT_FINISHED', 'NO_DIDNT_SHOW', 'ADMIN_FLAGGED');

-- AlterTable matches: add completion-check tracking fields
ALTER TABLE "matches"
  ADD COLUMN "completionCheckSentAt"  TIMESTAMP(3),
  ADD COLUMN "completionCheckStatus"  "CompletionCheckStatus",
  ADD COLUMN "completionCheckRetries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewRequestSentAt"    TIMESTAMP(3);

-- AlterTable reviews: make jobId nullable to support cash pilot jobs (no Job record)
ALTER TABLE "reviews" ALTER COLUMN "jobId" DROP NOT NULL;

-- AlterTable reviews: add matchId for pilot cash-job reviews
ALTER TABLE "reviews" ADD COLUMN "matchId" TEXT;

-- AddForeignKey reviews -> matches
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "matches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: one customer/provider review per match (pilot path)
CREATE UNIQUE INDEX "reviews_matchId_reviewerType_key"
  ON "reviews"("matchId", "reviewerType");
