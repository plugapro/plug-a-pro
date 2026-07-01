import { describe, expect, it } from 'vitest'

import {
  buildQueueBreachAlertMessage,
  buildUnmatchedJobsAlertMessage,
} from '@/lib/ops-dashboard/alerts'
import { bodyContainsRawUrl } from '@/lib/whatsapp-copy'
import type { QueueBreachResult } from '@/lib/ops-dashboard/types'

// The ops WhatsApp alerts used to inline "Review: https://…" in the text body,
// which the central raw-URL guard rejects — every queue-breach alert silently
// failed from 2026-05-07 to 2026-07-01. These builders exist so the body stays
// guard-clean and the URL travels via the sendCtaUrl button payload instead.

const breach: QueueBreachResult = {
  queueKey: 'providerOnboarding',
  label: 'Provider Onboarding',
  overdueCount: 20,
  oldestAgeMinutes: 25981, // 18d 1h
  severity: 'breach',
}

describe('buildQueueBreachAlertMessage', () => {
  it('carries label, count and formatted age in the body', () => {
    const msg = buildQueueBreachAlertMessage(breach)
    expect(msg.body).toContain('Provider Onboarding')
    expect(msg.body).toContain('20 items overdue')
    expect(msg.body).toContain('18d 1h')
  })

  it('keeps the body free of raw URLs so the central send guard passes', () => {
    expect(bodyContainsRawUrl(buildQueueBreachAlertMessage(breach).body)).toBe(false)
  })

  it('keeps the CTA button text within Meta\'s 20-char limit', () => {
    const msg = buildQueueBreachAlertMessage(breach)
    expect(msg.buttonText.length).toBeGreaterThan(0)
    expect(msg.buttonText.length).toBeLessThanOrEqual(20)
  })

  it('uses singular copy for a single overdue item', () => {
    const msg = buildQueueBreachAlertMessage({
      ...breach,
      queueKey: 'dispatch',
      label: 'Dispatch',
      overdueCount: 1,
      oldestAgeMinutes: 18,
    })
    expect(msg.body).toContain('1 item overdue')
    expect(msg.body).toContain('18m')
  })
})

describe('buildUnmatchedJobsAlertMessage', () => {
  it('carries the unmatched count and no raw URL', () => {
    const msg = buildUnmatchedJobsAlertMessage(3)
    expect(msg.body).toContain('3 job request(s)')
    expect(bodyContainsRawUrl(msg.body)).toBe(false)
  })

  it('keeps the CTA button text within Meta\'s 20-char limit', () => {
    const msg = buildUnmatchedJobsAlertMessage(1)
    expect(msg.buttonText.length).toBeGreaterThan(0)
    expect(msg.buttonText.length).toBeLessThanOrEqual(20)
  })
})
