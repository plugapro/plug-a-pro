import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'crypto'

const RUN = process.env.SMILE_ID_RUN_SANDBOX_TESTS === '1'
const describeFn = RUN ? describe : describe.skip

describeFn('Smile ID sandbox round-trip', () => {
  beforeAll(() => {
    if (!process.env.SMILE_ID_PARTNER_ID || !process.env.SMILE_ID_API_KEY) {
      throw new Error('Set SMILE_ID_PARTNER_ID + SMILE_ID_API_KEY + SMILE_ID_BASE_URL to run')
    }
    if (process.env.SMILE_ID_BASE_URL !== 'https://testapi.smileidentity.com') {
      throw new Error('Refusing to run round-trip outside sandbox base URL')
    }
  })

  it('creates a Smile Link, disables it, and confirms shape', async () => {
    const { createSmileLink, disableSmileLink } = await import(
      '../../../../../lib/identity-verification/vendors/smile-id/smile-links-client'
    )

    const created = await createSmileLink({
      verificationId: `roundtrip-${Date.now()}`,
      providerId: null,
      partnerJobId: `pap-roundtrip-${randomUUID()}`,
      callbackUrl: 'https://example.invalid/webhook',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })

    expect(created.linkUrl).toMatch(/^https:\/\/.+/)
    expect(created.refId).toMatch(/.+/)

    const disabled = await disableSmileLink(created.refId)
    expect(disabled.acknowledged).toBe(true)
  }, 30_000)
})
