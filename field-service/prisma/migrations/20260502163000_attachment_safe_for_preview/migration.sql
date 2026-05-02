-- Add explicit safeForPreview flag on Attachment. Defaults to true for
-- backwards compatibility — existing customer-uploaded photos remain visible
-- in provider safe-preview payloads. Sensitive uploads (e.g. ID documents)
-- can be flagged false by the uploader or via admin moderation, after which
-- safe-preview renderers must exclude them.
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "safeForPreview" BOOLEAN NOT NULL DEFAULT true;
