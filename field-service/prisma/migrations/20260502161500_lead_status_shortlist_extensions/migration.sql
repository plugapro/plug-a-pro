-- Additive enum values for the Qualified Shortlist Model. Existing lead rows
-- are not modified. New code can opt in to the more granular states; legacy
-- code paths continue to read/write SENT, VIEWED, ACCEPTED, DECLINED, EXPIRED
-- without any schema-level breakage.
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'INTERESTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'SHORTLISTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CUSTOMER_SELECTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
