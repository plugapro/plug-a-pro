-- CreateTable
CREATE TABLE "reason_codes" (
    "key" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requireNote" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reason_codes_key_queueType_key" UNIQUE ("key", "queueType")
);
