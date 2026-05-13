import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendButtons: vi.fn().mockResolvedValue('msg-buttons'),
  sendText: vi.fn().mockResolvedValue('msg-text'),
}))

import { resolveJourneyRecovery, sendWhatsAppJourneyRecovery } from '@/lib/journey-recovery'
import * as wa from '@/lib/whatsapp-interactive'

describe('journey recovery resolver', () => {
  it('preserves state and resumes active customer request flows', () => {
    const plan = resolveJourneyRecovery({
      userRole: 'customer',
      channel: 'whatsapp',
      flowName: 'job_request',
      currentStep: 'collect_address_street',
      failureType: 'stale_action',
      recoveryClass: 'resume_step',
    })

    expect(plan.message).toContain('service request')
    expect(plan.preserveState).toBe(true)
    expect(plan.clearState).toBe(false)
    expect(plan.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'flow_continue' }),
      expect.objectContaining({ id: 'start_cancel' }),
    ]))
  })

  it('returns status recovery for status dependency failures', () => {
    const plan = resolveJourneyRecovery({
      userRole: 'customer',
      channel: 'whatsapp',
      flowName: 'status',
      currentStep: 'status_show',
      failureType: 'dependency_failure',
      recoveryClass: 'show_status',
      requestId: 'jr_123',
    })

    expect(plan.message).toContain('latest status')
    expect(plan.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'status', title: 'Check status' }),
    ]))
  })

  it('sends WhatsApp recovery as buttons with structured metadata', async () => {
    await sendWhatsAppJourneyRecovery('+27821234567', {
      userRole: 'provider',
      channel: 'whatsapp',
      flowName: 'registration',
      currentStep: 'reg_collect_profile_photo',
      failureType: 'storage_failure',
      recoveryClass: 'retry_same_step',
      error: new Error('blob timeout'),
    })

    expect(wa.sendButtons).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining("couldn't upload that photo"),
      expect.arrayContaining([
        expect.objectContaining({ id: 'retry_step' }),
        expect.objectContaining({ id: 'back_home' }),
      ]),
      undefined,
      expect.objectContaining({
        templateName: 'interactive:journey_recovery',
        metadata: expect.objectContaining({
          flowName: 'registration',
          step: 'reg_collect_profile_photo',
          failureType: 'storage_failure',
        }),
      }),
    )
  })
})
