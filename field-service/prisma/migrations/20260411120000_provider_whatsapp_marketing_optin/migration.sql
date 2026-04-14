-- AddColumn: Provider.whatsappMarketingOptIn
-- Defaults to true — existing providers are implicitly opted in until they opt out.
-- This field gates MARKETING-category WhatsApp template delivery to providers.

ALTER TABLE "providers" ADD COLUMN "whatsappMarketingOptIn" BOOLEAN NOT NULL DEFAULT true;
