-- Additive: creates provider_resume_tokens table for hashed single-use web-resume tokens.
-- No existing tables are modified.

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_resume_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "issuedByAdminUserId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "source" TEXT NOT NULL,

    CONSTRAINT "provider_resume_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_resume_tokens_tokenHash_key" ON "provider_resume_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_resume_tokens_conversationId_idx" ON "provider_resume_tokens"("conversationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "provider_resume_tokens_phone_expiresAt_idx" ON "provider_resume_tokens"("phone", "expiresAt");

-- AddForeignKey
ALTER TABLE "provider_resume_tokens" ADD CONSTRAINT "provider_resume_tokens_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_resume_tokens" ADD CONSTRAINT "provider_resume_tokens_issuedByAdminUserId_fkey" FOREIGN KEY ("issuedByAdminUserId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EnableRLS
ALTER TABLE "public"."provider_resume_tokens" ENABLE ROW LEVEL SECURITY;
