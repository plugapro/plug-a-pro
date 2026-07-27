-- Additive only: pull-based lead board discriminator. Existing rows default to PUSH.
ALTER TABLE "public"."leads" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'PUSH';
