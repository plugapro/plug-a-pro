export function getPaymentAdminMessage(code?: string | null) {
  switch (code) {
    case 'refund_issued':
      return { tone: 'success' as const, text: 'Refund request recorded successfully.' }
    case 'invalid_refund_amount':
      return { tone: 'error' as const, text: 'Enter a valid refund amount within the remaining paid balance.' }
    case 'refund_unavailable':
      return { tone: 'error' as const, text: 'This payment can no longer be refunded from the console.' }
    case 'refund_failed':
      return { tone: 'error' as const, text: 'Refund could not be completed right now. Check the PSP configuration and try again.' }
    default:
      return null
  }
}

export function getApplicationsAdminMessage(code?: string | null) {
  switch (code) {
    case 'duplicate_active_application':
      return {
        tone: 'error' as const,
        text: 'Approval blocked because another active application already exists for this phone number.',
      }
    case 'incomplete_application_for_approval':
      return {
        tone: 'error' as const,
        text: 'Approval blocked because required onboarding fields are missing. Ask the provider for more information and review again.',
      }
    default:
      return null
  }
}

export function getBookingAdminMessage(code?: string | null) {
  switch (code) {
    case 'payment_marked':
      return { tone: 'success' as const, text: 'Payment status updated successfully.' }
    case 'payment_unavailable':
      return { tone: 'error' as const, text: 'This booking can no longer be marked paid from its current state.' }
    default:
      return null
  }
}

export function getDispatchAdminMessage(code?: string | null) {
  switch (code) {
    case 'dispatch_updated':
      return { tone: 'success' as const, text: 'Dispatch action completed successfully.' }
    case 'dispatch_failed':
      return { tone: 'error' as const, text: 'Dispatch action could not be completed right now. Refresh the queue and try again.' }
    case 'override_assigned':
      return { tone: 'success' as const, text: 'Provider manually assigned. Dispatch case updated.' }
    case 'dispatch_override_failed':
      return { tone: 'error' as const, text: 'Override could not be completed. Check provider availability and try again.' }
    case 'redispatch_triggered':
      return { tone: 'success' as const, text: 'Re-match triggered. Candidates will be re-evaluated shortly.' }
    case 'redispatch_failed':
      return { tone: 'error' as const, text: 'Re-match could not be triggered. Retry or escalate manually.' }
    case 'escalation_recorded':
      return { tone: 'success' as const, text: 'Escalation recorded on the dispatch case.' }
    case 'escalation_failed':
      return { tone: 'error' as const, text: 'Escalation could not be recorded. Check the dispatch case and try again.' }
    default:
      return null
  }
}
