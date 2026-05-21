import { describe, expect, it } from 'vitest'
import { bucketProviderPortalJob } from '@/lib/provider-job-status'

describe('provider job status bucketing', () => {
  it('classifies future scheduled jobs as upcoming', () => {
    const bucket = bucketProviderPortalJob({
      status: 'SCHEDULED',
      scheduledDate: new Date('2026-05-23T00:00:00.000Z'),
    })

    expect(bucket).toBe('upcoming')
  })

  it('does not classify scheduled jobs as in_progress', () => {
    const bucket = bucketProviderPortalJob({ status: 'SCHEDULED' })
    expect(bucket).not.toBe('in_progress')
  })

  it('classifies started jobs as in_progress', () => {
    const bucket = bucketProviderPortalJob({ status: 'STARTED' })
    expect(bucket).toBe('in_progress')
  })

  it('classifies completed jobs as completed', () => {
    const bucket = bucketProviderPortalJob({ status: 'COMPLETED' })
    expect(bucket).toBe('completed')
  })

  it('flags unknown statuses as unsupported', () => {
    const bucket = bucketProviderPortalJob({ status: 'UNKNOWN_STATUS' })
    expect(bucket).toBe('unsupported')
  })

  it('flags invalid scheduled dates as unsupported', () => {
    const bucket = bucketProviderPortalJob({
      status: 'SCHEDULED',
      scheduledDate: new Date('invalid'),
    })

    expect(bucket).toBe('unsupported')
  })
})
