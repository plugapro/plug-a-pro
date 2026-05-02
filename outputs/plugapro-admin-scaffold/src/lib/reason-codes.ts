// Reason code registry. Used by close-out dialogs, block/suspend dialogs,
// refunds, etc. Codes marked with `requiresNote: true` require the operator
// to type a free-text reason before submitting.

export type ReasonCodeCategory =
  | 'customer.block'
  | 'customer.suspend'
  | 'customer.delete'
  | 'customer.merge'
  | 'provider.suspend'
  | 'provider.deactivate'
  | 'provider.strike'
  | 'payment.refund'
  | 'payment.writeoff'
  | 'booking.cancel'
  | 'request.cancel'
  | 'quote.void'
  | 'dispute.resolve'
  | 'adminuser.revoke';

export interface ReasonCode {
  code: string;
  label: string;
  requiresNote?: boolean;
}

export const REASON_CODES: Record<ReasonCodeCategory, ReasonCode[]> = {
  'customer.block': [
    { code: 'FRAUD_SUSPECTED', label: 'Fraud suspected' },
    { code: 'ABUSIVE_BEHAVIOUR', label: 'Abusive behaviour' },
    { code: 'CHARGEBACK_HISTORY', label: 'Chargeback history' },
    { code: 'CUSTOMER_REQUEST', label: 'Customer requested block' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'customer.suspend': [
    { code: 'INVESTIGATION', label: 'Under investigation' },
    { code: 'PAYMENT_HOLD', label: 'Payment hold' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'customer.delete': [
    { code: 'GDPR_POPIA_REQUEST', label: 'Privacy request (POPIA/GDPR)' },
    { code: 'DUPLICATE', label: 'Duplicate record' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'customer.merge': [
    { code: 'DUPLICATE_PHONE', label: 'Duplicate phone' },
    { code: 'DUPLICATE_EMAIL', label: 'Duplicate email' },
    { code: 'CUSTOMER_CONFIRMED', label: 'Customer confirmed duplicate' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'provider.suspend': [
    { code: 'COMPLAINT_PENDING', label: 'Open complaint pending' },
    { code: 'CERTIFICATION_EXPIRED', label: 'Certification expired' },
    { code: 'NO_SHOW_STREAK', label: 'Multiple no-shows' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'provider.deactivate': [
    { code: 'SAFETY_CONCERN', label: 'Safety concern' },
    { code: 'PROVIDER_REQUEST', label: 'Provider left platform' },
    { code: 'POLICY_VIOLATION', label: 'Policy violation' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'provider.strike': [
    { code: 'NO_SHOW', label: 'No-show' },
    { code: 'LATE', label: 'Late to appointment' },
    { code: 'QUALITY', label: 'Quality complaint upheld' },
    { code: 'COMMUNICATION', label: 'Communication failure' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'payment.refund': [
    { code: 'GOODWILL', label: 'Goodwill' },
    { code: 'POLICY', label: 'Policy-mandated refund' },
    { code: 'DUPLICATE', label: 'Duplicate charge' },
    { code: 'DISPUTE_UPHELD', label: 'Dispute upheld' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'payment.writeoff': [
    { code: 'UNCOLLECTABLE', label: 'Uncollectable' },
    { code: 'FRAUD', label: 'Fraudulent charge' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'booking.cancel': [
    { code: 'CUSTOMER_CANCELLED', label: 'Customer cancelled' },
    { code: 'PROVIDER_UNAVAILABLE', label: 'Provider unavailable' },
    { code: 'OPS_CANCELLED', label: 'Ops cancelled' },
    { code: 'WEATHER', label: 'Weather / force majeure' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'request.cancel': [
    { code: 'CUSTOMER_CANCELLED', label: 'Customer cancelled' },
    { code: 'COVERAGE_GAP', label: 'No provider coverage' },
    { code: 'OPS_CANCELLED', label: 'Ops cancelled' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'quote.void': [
    { code: 'EXPIRED', label: 'Expired' },
    { code: 'REVISION_REQUESTED', label: 'Customer requested revision' },
    { code: 'BUG', label: 'Created in error' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
  'dispute.resolve': [
    { code: 'UPHELD_CUSTOMER', label: 'Upheld — customer' },
    { code: 'UPHELD_PROVIDER', label: 'Upheld — provider' },
    { code: 'PARTIAL_REFUND', label: 'Partial refund issued' },
    { code: 'NO_ACTION', label: 'No action required' },
    { code: 'ESCALATED_LEGAL', label: 'Escalated to legal' },
  ],
  'adminuser.revoke': [
    { code: 'LEFT_COMPANY', label: 'Left the company' },
    { code: 'ROLE_CHANGE', label: 'Internal role change' },
    { code: 'SECURITY', label: 'Security incident' },
    { code: 'OTHER', label: 'Other', requiresNote: true },
  ],
};

export function reasonsFor(category: ReasonCodeCategory): ReasonCode[] {
  return REASON_CODES[category] ?? [];
}
