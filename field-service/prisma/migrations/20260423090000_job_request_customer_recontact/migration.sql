ALTER TABLE "job_requests"
ADD COLUMN "customerNoMatchNotifiedAt" TIMESTAMP(3),
ADD COLUMN "customerRematchCheckSentAt" TIMESTAMP(3),
ADD COLUMN "customerRematchCheckRespondedAt" TIMESTAMP(3),
ADD COLUMN "customerRematchCheckOutcome" TEXT;
