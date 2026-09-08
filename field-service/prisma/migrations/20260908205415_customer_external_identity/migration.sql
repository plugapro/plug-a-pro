-- Task 11: CustomerExternalIdentity — federated customer identity for
-- marketplace host login (e.g. VodaPay Mini App). Links a Customer to a
-- host-issued external user id and stores an encrypted host access token
-- for later refund/inquiry calls. Additive only.

-- CreateTable
CREATE TABLE "customer_external_identities" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "tokenCipher" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_external_identities_customerId_idx" ON "customer_external_identities"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_external_identities_provider_externalId_key" ON "customer_external_identities"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "customer_external_identities" ADD CONSTRAINT "customer_external_identities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
