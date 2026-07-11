-- SEC-01 / P0-7: ProviderApplication.idNumber at-rest encryption (POPIA §26).
-- Additive only: adds encrypted + last4 columns alongside the existing
-- plaintext column. The plaintext column is NOT dropped, renamed, or nulled
-- here — retirement is a later, manual, verified step via
-- scripts/retire-plaintext-id-numbers.ts (docs/security/id-number-encryption.md).

-- AlterTable
ALTER TABLE "provider_applications" ADD COLUMN     "idNumberCiphertext" TEXT,
ADD COLUMN     "idNumberLast4" VARCHAR(4);
