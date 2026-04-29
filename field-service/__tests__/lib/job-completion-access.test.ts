import { beforeEach, describe, expect, it } from 'vitest'
import {
  createJobCompletionToken,
  getJobCompletionUrl,
  verifyJobCompletionToken,
} from '@/lib/job-completion-access'

describe('job completion access tokens', () => {
  beforeEach(() => {
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-completion-secret'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.plugapro.co.za'
  })

  it('creates and verifies a valid completion token', () => {
    const token = createJobCompletionToken({ jobId: 'job-1', customerId: 'cust-1' })
    const result = verifyJobCompletionToken(token)

    expect(result).toMatchObject({
      status: 'active',
      payload: { jobId: 'job-1', customerId: 'cust-1', v: 1 },
    })
  })

  it('rejects a tampered token', () => {
    const token = createJobCompletionToken({ jobId: 'job-1', customerId: 'cust-1' })
    const [payload, sig] = token.split('.')
    const tampered = `${payload}x.${sig}`

    expect(verifyJobCompletionToken(tampered).status).toBe('invalid')
  })

  it('rejects an expired token', () => {
    const pastExpiry = new Date(Date.now() - 1000)
    const token = createJobCompletionToken({
      jobId: 'job-1',
      customerId: 'cust-1',
      expiresAt: pastExpiry,
    })

    expect(verifyJobCompletionToken(token).status).toBe('expired')
  })

  it('returns invalid for a token with missing parts', () => {
    expect(verifyJobCompletionToken('notavalidtoken').status).toBe('invalid')
    expect(verifyJobCompletionToken('').status).toBe('invalid')
    expect(verifyJobCompletionToken('only.one').status).toBe('invalid')
  })

  it('builds a signed URL at the configured app URL', () => {
    const url = getJobCompletionUrl({ jobId: 'job-1', customerId: 'cust-1' })

    expect(url).toMatch(/^https:\/\/app\.plugapro\.co\.za\/confirm-completion\//)

    const token = decodeURIComponent(url!.split('/confirm-completion/')[1])
    const verified = verifyJobCompletionToken(token)
    expect(verified).toMatchObject({
      status: 'active',
      payload: { jobId: 'job-1', customerId: 'cust-1' },
    })
  })

  it('returns null when NEXT_PUBLIC_APP_URL is not set', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const url = getJobCompletionUrl({ jobId: 'job-1', customerId: 'cust-1' })
    expect(url).toBeNull()
  })
})
