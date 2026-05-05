ALTER TABLE "attachments" ADD COLUMN "providerApplicationId" TEXT;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_providerApplicationId_fkey"
  FOREIGN KEY ("providerApplicationId") REFERENCES "provider_applications"("id") ON DELETE SET NULL;
