-- Task 16 round 2 (I-4 residual 2): atomic per-booking VodaPay checkout
-- attempt counter. Moves the counter off Payment.metadata (non-atomic
-- read-modify-write, race-prone under concurrent checkout initiations) onto
-- a dedicated column updated via a single atomic `{ increment: 1 }` UPDATE.
-- Additive only - existing rows default to 0 ("no VodaPay attempts yet"),
-- no backfill required.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "vodapayAttempt" INTEGER NOT NULL DEFAULT 0;
