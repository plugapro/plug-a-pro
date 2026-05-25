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
    expect(schema).toContain('identityVerifications ProviderIdentityVerification[]')
    expect(schema).toContain('provider              Provider?')
    expect(schema).toContain('providerApplication   ProviderApplication?')
  })
})
