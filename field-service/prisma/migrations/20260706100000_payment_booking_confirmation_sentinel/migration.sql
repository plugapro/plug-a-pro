-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "bookingConfirmationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bookingConfirmationSentAt" TIMESTAMP(3);

