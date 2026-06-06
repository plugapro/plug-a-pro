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

  it('maps template-based recovery sends to a distinct success message', () => {
    expect(getApplicationsAdminMessage('recovery_sent_template')).toEqual({
      tone: 'success',
      text: 'Recovery template message sent.',
    })
  })

  it('maps template-not-approved errors to a clear operator remediation', () => {
    expect(getApplicationsAdminMessage('recovery_template_not_approved')).toEqual({
      tone: 'error',
      text: 'Template not approved in Meta. Approve the recovery template set before retrying.',
    })
  })
})
