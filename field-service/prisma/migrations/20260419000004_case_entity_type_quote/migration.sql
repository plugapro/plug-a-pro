-- Add QUOTE to CaseEntityType enum so QUOTE_APPROVAL cases can be keyed by quote ID
-- Fixes: cases with queueType=QUOTE_APPROVAL were previously typed as MATCH, which
-- mislabelled the entity and would cause confusion when looking up the referenced record.

ALTER TYPE "CaseEntityType" ADD VALUE IF NOT EXISTS 'QUOTE';
