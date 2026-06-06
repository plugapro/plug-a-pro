import { describe, expect, it } from 'vitest'
import {
  getApplicationsAdminMessage,
  getBookingAdminMessage,
  getDispatchAdminMessage,
  getPaymentAdminMessage,
} from '@/lib/admin-action-messages'

describe('admin action messages', () => {
  it('maps refund failure to safe operator guidance', () => {
    expect(getPaymentAdminMessage('refund_failed')).toEqual({
      tone: 'error',
      text: 'Refund could not be completed right now. Check the PSP configuration and try again.',
    })
  })

  it('maps duplicate application approval blocks to a clear operator message', () => {
    expect(getApplicationsAdminMessage('duplicate_active_application')).toEqual({
      tone: 'error',
      text: 'Approval blocked because another active application already exists for this phone number.',
    })
  })

  it('maps template recovery sends to a clear success message', () => {
    expect(getApplicationsAdminMessage('recovery_sent_template')).toEqual({
      tone: 'success',
      text: 'Recovery template sent successfully outside the 23h WhatsApp session window.',
    })
  })

  it('maps unapproved recovery templates to a clear operator blocker', () => {
    expect(getApplicationsAdminMessage('recovery_template_not_approved')).toEqual({
      tone: 'error',
      text: 'Recovery template is not approved in Meta yet. Keep the row queued or send only inside the 23h session window.',
    })
  })

  it('maps stale booking payment actions to a clear operator message', () => {
    expect(getBookingAdminMessage('payment_unavailable')).toEqual({
      tone: 'error',
      text: 'This booking can no longer be marked paid from its current state.',
    })
  })

  it('maps dispatch failures to safe operator guidance', () => {
    expect(getDispatchAdminMessage('dispatch_failed')).toEqual({
      tone: 'error',
      text: 'Dispatch action could not be completed right now. Refresh the queue and try again.',
    })
  })
})
