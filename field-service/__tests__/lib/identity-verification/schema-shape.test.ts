import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

describe('provider identity verification schema', () => {
  it('defines the identity verification enums and tables', () => {
    for (const enumName of [
      'IdentityBasis',
      'IdentityDocumentKind',
      'VerificationStatus',
      'VerificationDecision',
      'VerificationChannel',
      'VerificationAssuranceLevel',
      'VerificationDocumentStatus',
      'SensitiveIdentityAccessType',
    ]) {
      expect(schema).toContain(`enum ${enumName}`)
    }

    for (const modelName of [
      'ProviderIdentityVerification',
      'ProviderIdentityDocument',
      'ProviderVerificationEvent',
      'ProviderVerificationReview',
      'ProviderSensitiveDataAccessLog',
    ]) {
      expect(schema).toContain(`model ${modelName}`)
    }
  })

  it('keeps identity records related to provider and provider application records', () => {
    // Whitespace-tolerant matches: Prisma's auto-formatter realigns column
    // widths whenever the longest column name in the model changes (e.g.
    // when a new field like vendorWorkflowId is added). The assertion is on
    // shape, not on spacing.
    expect(schema).toMatch(/identityVerifications\s+ProviderIdentityVerification\[\]/)
    expect(schema).toMatch(/\bprovider\s+Provider\?\s+@relation\(fields: \[providerId\]/)
    expect(schema).toMatch(/\bproviderApplication\s+ProviderApplication\?\s+@relation\(fields: \[providerApplicationId\]/)
  })

  it('marks legacy identity verification rows outside the attempt cap by defaulting new rows in', () => {
    expect(schema).toMatch(/countsTowardAttemptCap\s+Boolean\s+@default\(true\)/)
    expect(schema).toContain('@@index([providerId, status, countsTowardAttemptCap])')
  })
})
