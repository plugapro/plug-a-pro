-- Add expiresAt to ExtraWork so approval tokens expire after 48 hours
ALTER TABLE "extra_work" ADD COLUMN "expiresAt" TIMESTAMP(3);
