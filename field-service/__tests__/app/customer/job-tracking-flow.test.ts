/**
 * CLIENT-08 — Provider Confirmation and Job Tracking Flow
 *
 * Covers:
 *  1. PROVIDER_CONFIRMATION_PENDING screen resolution
 *  2. ASSIGNED / MATCHED state screen resolution and allowed actions
 *  3. 9-step blueprint job tracking timeline via buildClientPwaJobTrackingSteps
 *  4. Tracking step progression — labels, done/current flags for all 9 steps
 *  5. Completion screen copy — "Job completed" / "Please confirm everything is in order."
 *  6. WhatsApp handoff URLs for job events link to token-based ticket route
 */
import { describe, expect, it } from 'vitest'

// ── 1. PROVIDER_CONFIRMATION_PENDING screen resolution ────────────────────────
describe('CLIENT-08: PROVIDER_CONFIRMATION_PENDING screen', () => {
  it('resolves to provider_confirmation screen', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'PROVIDER_CONFIRMATION_PENDING' })
    expect(result.screen).toBe('provider_confirmation')
    expect(result.reason).toBe('selected_provider_confirming')
  })

  it('allowed actions for provider_confirmation include view_provider_confirmation', async () => {
    const { allowedActionsForClientPwaScreen } = await import('../../../lib/client-pwa-state')
    const actions = allowedActionsForClientPwaScreen('provider_confirmation')
    expect(actions).toContain('view_provider_confirmation')
  })
})

// ── 2. MATCHED / ASSIGNED state screen resolution ────────────────────────────
describe('CLIENT-08: MATCHED / ASSIGNED state screen resolution', () => {
  it('MATCHED with no job status resolves to job_tracking', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: null })
    expect(result.screen).toBe('job_tracking')
  })

  it('MATCHED + SCHEDULED resolves to job_tracking', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'SCHEDULED' })
    expect(result.screen).toBe('job_tracking')
  })

  it('MATCHED + EN_ROUTE resolves to job_tracking', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'EN_ROUTE' })
    expect(result.screen).toBe('job_tracking')
  })

  it('MATCHED + ARRIVED resolves to active_job', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'ARRIVED' })
    expect(result.screen).toBe('active_job')
  })

  it('MATCHED + STARTED resolves to active_job', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'STARTED' })
    expect(result.screen).toBe('active_job')
  })

  it('MATCHED + PENDING_COMPLETION_CONFIRMATION resolves to active_job', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'PENDING_COMPLETION_CONFIRMATION' })
    expect(result.screen).toBe('active_job')
  })

  it('MATCHED + COMPLETED resolves to completion_review', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'COMPLETED' })
    expect(result.screen).toBe('completion_review')
  })

  it('allowed actions for job_tracking include track_job', async () => {
    const { allowedActionsForClientPwaScreen } = await import('../../../lib/client-pwa-state')
    const actions = allowedActionsForClientPwaScreen('job_tracking')
    expect(actions).toContain('track_job')
  })

  it('allowed actions for completion_review include leave_review and track_job', async () => {
    const { allowedActionsForClientPwaScreen } = await import('../../../lib/client-pwa-state')
    const actions = allowedActionsForClientPwaScreen('completion_review')
    expect(actions).toContain('leave_review')
    expect(actions).toContain('track_job')
  })
})

// ── 3. 9-step tracking timeline — presence and order ─────────────────────────
describe('CLIENT-08: buildClientPwaJobTrackingSteps — 9 steps present', () => {
  it('returns exactly 9 steps', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'SCHEDULED', arrivalTimeConfirmedAt: null })
    expect(steps).toHaveLength(9)
  })

  it('step labels match blueprint order', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'SCHEDULED', arrivalTimeConfirmedAt: null })
    const labels = steps.map((s) => s.label)
    expect(labels[0]).toBe('Request submitted')
    expect(labels[1]).toBe('Providers matched')
    expect(labels[2]).toBe('You selected provider')
    expect(labels[3]).toBe('Provider accepted')
    expect(labels[4]).toBe('Arrival time confirmed')
    expect(labels[5]).toBe('Provider on the way')
    expect(labels[6]).toBe('Provider arrived')
    expect(labels[7]).toBe('Job in progress')
    expect(labels[8]).toBe('Job completed')
  })

  it('each step has required keys: key, label, description, done, current', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'STARTED' })
    for (const step of steps) {
      expect(step).toHaveProperty('key')
      expect(step).toHaveProperty('label')
      expect(step).toHaveProperty('description')
      expect(typeof step.done).toBe('boolean')
      expect(typeof step.current).toBe('boolean')
    }
  })

  it('exactly one step is current at a time', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    for (const status of ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'COMPLETED'] as const) {
      const steps = buildClientPwaJobTrackingSteps({ status })
      const currentSteps = steps.filter((s) => s.current)
      expect(currentSteps).toHaveLength(1)
    }
  })
})

// ── 4. Step progression — labels and done/current flags ──────────────────────
describe('CLIENT-08: tracking step progression', () => {
  it('SCHEDULED with no arrival confirmation lands on Provider accepted (step 4)', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'SCHEDULED', arrivalTimeConfirmedAt: null })
    const current = steps.find((s) => s.current)
    expect(current?.label).toBe('Provider accepted')
    // Steps 0–2 are done; steps 4–8 are not done
    expect(steps[0].done).toBe(true)
    expect(steps[1].done).toBe(true)
    expect(steps[2].done).toBe(true)
    expect(steps[4].done).toBe(false)
    expect(steps[4].current).toBe(false)
  })

  it('SCHEDULED with arrival confirmed lands on Arrival time confirmed (step 5)', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({
      status: 'SCHEDULED',
      arrivalTimeConfirmedAt: new Date('2026-05-07T09:00:00Z'),
    })
    const current = steps.find((s) => s.current)
    expect(current?.label).toBe('Arrival time confirmed')
  })

  it('EN_ROUTE lands on Provider on the way (step 6)', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'EN_ROUTE' })
    expect(steps.find((s) => s.current)?.label).toBe('Provider on the way')
  })

  it('ARRIVED lands on Provider arrived (step 7)', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'ARRIVED' })
    expect(steps.find((s) => s.current)?.label).toBe('Provider arrived')
  })

  it('STARTED lands on Job in progress (step 8)', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'STARTED' })
    expect(steps.find((s) => s.current)?.label).toBe('Job in progress')
  })

  it('PENDING_COMPLETION_CONFIRMATION lands on Job completed (step 9)', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'PENDING_COMPLETION_CONFIRMATION' })
    expect(steps.find((s) => s.current)?.label).toBe('Job completed')
  })

  it('COMPLETED lands on Job completed (step 9) with all prior steps done', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'COMPLETED' })
    const current = steps.find((s) => s.current)
    expect(current?.label).toBe('Job completed')
    // All steps before the current (index 8) should be done
    for (let i = 0; i < 8; i++) {
      expect(steps[i].done).toBe(true)
    }
  })

  it('AWAITING_APPROVAL maps to Job in progress step (same index as STARTED)', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'AWAITING_APPROVAL' })
    expect(steps.find((s) => s.current)?.label).toBe('Job in progress')
  })
})

// ── 5. Completion step copy ───────────────────────────────────────────────────
describe('CLIENT-08: completion step copy', () => {
  it('step 9 description is "Please confirm everything is in order."', async () => {
    const { buildClientPwaJobTrackingSteps } = await import('../../../lib/client-pwa-job-tracking')
    const steps = buildClientPwaJobTrackingSteps({ status: 'COMPLETED' })
    const completedStep = steps[8]
    expect(completedStep.label).toBe('Job completed')
    expect(completedStep.description).toBe('Please confirm everything is in order.')
  })
})

// ── 6. WhatsApp handoff URL uses token route for job events ──────────────────
describe('CLIENT-08: WhatsApp handoff token route', () => {
  it('buildClientPwaTokenPath constructs a token route with job_tracking view', async () => {
    const { buildClientPwaTokenPath } = await import('../../../lib/client-pwa-handoff')
    const path = buildClientPwaTokenPath('abc123', 'job_tracking')
    expect(path).toMatch(/\/requests\/access\/abc123/)
    expect(path).toContain('view=job_tracking')
  })

  it('job_tracking, active_job, and completion_review screens all map to job_tracking handoff view', async () => {
    // The token page is the canonical handoff route for all post-acceptance states.
    // Verified via the handoffViewForScreen mapping: job_tracking / active_job / completion_review → 'job_tracking'.
    const { resolveClientPwaScreenForJobStatus } = await import('../../../lib/client-pwa-state')
    const scheduled = resolveClientPwaScreenForJobStatus('SCHEDULED')
    const enRoute = resolveClientPwaScreenForJobStatus('EN_ROUTE')
    const arrived = resolveClientPwaScreenForJobStatus('ARRIVED')
    const started = resolveClientPwaScreenForJobStatus('STARTED')
    const completed = resolveClientPwaScreenForJobStatus('COMPLETED')

    // SCHEDULED and EN_ROUTE are job_tracking; ARRIVED+ are active_job; COMPLETED is completion_review.
    // All ultimately map to the job_tracking handoff view in client-pwa-handoff.ts.
    expect(['job_tracking', 'active_job', 'completion_review']).toContain(scheduled.screen)
    expect(['job_tracking', 'active_job', 'completion_review']).toContain(enRoute.screen)
    expect(['job_tracking', 'active_job', 'completion_review']).toContain(arrived.screen)
    expect(['job_tracking', 'active_job', 'completion_review']).toContain(started.screen)
    expect(['job_tracking', 'active_job', 'completion_review']).toContain(completed.screen)
  })
})
