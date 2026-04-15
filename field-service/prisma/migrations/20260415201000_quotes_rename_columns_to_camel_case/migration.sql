-- Rename snake_case quote columns back to camelCase to match Prisma schema.
-- These were inadvertently renamed to snake_case in production; the baseline
-- and all code expect camelCase column names.

ALTER TABLE "quotes" RENAME COLUMN "approval_token"  TO "approvalToken";
ALTER TABLE "quotes" RENAME COLUMN "labour_cost"     TO "labourCost";
ALTER TABLE "quotes" RENAME COLUMN "materials_cost"  TO "materialsCost";
ALTER TABLE "quotes" RENAME COLUMN "estimated_hours" TO "estimatedHours";
ALTER TABLE "quotes" RENAME COLUMN "preferred_date"  TO "preferredDate";
ALTER TABLE "quotes" RENAME COLUMN "post_inspection" TO "postInspection";
