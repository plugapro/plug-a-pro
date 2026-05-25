-- Align production drift with the committed Prisma schema and original
-- qualified-shortlist migration. Some production databases still have
-- provider_lead_responses.response as the old LeadResponseStatus enum, which
-- Prisma 6 cannot decode when the schema field is String.
ALTER TABLE "provider_lead_responses"
  ALTER COLUMN "response" TYPE TEXT
  USING "response"::text;
