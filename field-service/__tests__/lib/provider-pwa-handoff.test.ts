import { describe, expect, it } from 'vitest'
import {
  PROVIDER_PWA_HANDOFF_MAP,
  resolveProviderPwaHandoffPath,
} from '@/lib/provider-pwa-handoff'

describe('provider PWA handoff resolver', () => {
  it('maps WhatsApp events to existing provider PWA routes', () => {
    expect(PROVIDER_PWA_HANDOFF_MAP.application_approved).toBe('/provider')
    expect(PROVIDER_PWA_HANDOFF_MAP.credits_low).toBe('/provider/credits')
    expect(PROVIDER_PWA_HANDOFF_MAP.new_opportunity).toBe('/provider/leads')
    expect(PROVIDER_PWA_HANDOFF_MAP.job_accepted).toBe('/provider/jobs')
  })

  it('routes an old opportunity token to the canonical signed lead screen', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'new_opportunity',
      token: 'signed.token',
      lead: {
        id: 'lead-1',
        status: 'VIEWED',
        jobRequestId: 'request-1',
        jobRequest: { match: null },
      },
    })).toBe('/leads/access/signed.token')
  })

  it('routes an old opportunity token to accepted job state after acceptance', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'new_opportunity',
      token: 'signed.token',
      lead: {
        id: 'lead-1',
        status: 'ACCEPTED',
        jobRequestId: 'request-1',
        jobRequest: {
          match: {
            id: 'match-1',
            status: 'QUOTE_APPROVED',
          },
        },
      },
    })).toBe('/leads/access/signed.token')
  })

  it('uses provider credits route for low-credit handoff without creating a duplicate wallet screen', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'credits_low',
    })).toBe('/provider/credits')
  })

  it('routes application events to the application status page', () => {
    expect(PROVIDER_PWA_HANDOFF_MAP.start_application).toBe('/provider/application')
    expect(PROVIDER_PWA_HANDOFF_MAP.continue_application).toBe('/provider/application')
    expect(PROVIDER_PWA_HANDOFF_MAP.more_info_required).toBe('/provider/application')
    expect(PROVIDER_PWA_HANDOFF_MAP.application_status).toBe('/provider/application')
  })

  it('routes application_approved to the dashboard (not the application page)', () => {
    expect(PROVIDER_PWA_HANDOFF_MAP.application_approved).toBe('/provider')
  })

  it('routes credits_history to the credits page', () => {
    expect(PROVIDER_PWA_HANDOFF_MAP.credits_history).toBe('/provider/credits')
  })

  it('resolveProviderPwaHandoffPath falls through to map when no token provided for application_status', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'application_status',
    })).toBe('/provider/application')
  })

  // ── State-aware job routing ────────────────────────────────────────────────

  it('routes confirm_arrival with jobId to the job-specific handover page', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'confirm_arrival',
      jobId: 'job-abc',
    })).toBe('/provider/jobs/job-abc/handover')
  })

  it('routes confirm_arrival with jobId and token to handover with token query param', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'confirm_arrival',
      token: 'signed.token',
      jobId: 'job-abc',
    })).toBe('/provider/jobs/job-abc/handover?token=signed.token')
  })

  it('routes complete_job with jobId to the job-specific handover page', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'complete_job',
      jobId: 'job-xyz',
    })).toBe('/provider/jobs/job-xyz/handover')
  })

  it('routes job_accepted with jobId to the job-specific handover page', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'job_accepted',
      jobId: 'job-def',
    })).toBe('/provider/jobs/job-def/handover')
  })

  it('falls back to the jobs list when confirm_arrival has no jobId and no lead', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'confirm_arrival',
    })).toBe('/provider/jobs')
  })

  it('falls back to the jobs list when complete_job has no jobId and no lead', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'complete_job',
    })).toBe('/provider/jobs')
  })

  it('derives jobId from lead.jobRequestId for confirm_arrival when no explicit jobId', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'confirm_arrival',
      lead: {
        id: 'lead-1',
        status: 'ACCEPTED',
        jobRequestId: 'request-from-lead',
        jobRequest: { match: null },
      },
    })).toBe('/provider/jobs/request-from-lead/handover')
  })

  it('prefers explicit jobId over lead.jobRequestId for job-scoped events', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'confirm_arrival',
      jobId: 'explicit-job-id',
      lead: {
        id: 'lead-1',
        status: 'ACCEPTED',
        jobRequestId: 'lead-job-id',
        jobRequest: { match: null },
      },
    })).toBe('/provider/jobs/explicit-job-id/handover')
  })

  it('lead token takes priority over jobId for opportunity events (new_opportunity)', () => {
    expect(resolveProviderPwaHandoffPath({
      event: 'new_opportunity',
      token: 'opp.token',
      jobId: 'job-123',
      lead: {
        id: 'lead-1',
        status: 'SENT',
        jobRequestId: 'request-1',
        jobRequest: { match: null },
      },
    })).toBe('/leads/access/opp.token')
  })
})
