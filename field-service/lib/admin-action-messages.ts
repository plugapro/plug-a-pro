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
    default:
      return null
  }
}
