/**
 * Canonical entity name strings used in AuditLog.entityType and
 * AdminAuditEvent.entityType. Always use these constants — never bare
 * string literals — so reads and writes always match.
 */
export const AUDIT_ENTITY = {
  CUSTOMER: 'Customer',
  CUSTOMER_NOTE: 'CustomerNote',
  PROVIDER: 'Provider',
  PROVIDER_NOTE: 'ProviderNote',
  JOB_REQUEST: 'JobRequest',
  QUOTE: 'Quote',
  BOOKING: 'Booking',
  JOB: 'Job',
  PAYMENT: 'Payment',
  PAYMENT_INTENT: 'PaymentIntent',
  PROVIDER_WALLET: 'ProviderWallet',
  LEAD_UNLOCK_DISPUTE: 'LeadUnlockDispute',
  DISPUTE: 'Dispute',
  LOCATION_NODE: 'LocationNode',
  CATEGORY: 'Category',
  ADMIN_USER: 'AdminUser',
  FEATURE_FLAG: 'FeatureFlag',
  CASE: 'Case',
  CASE_NOTE: 'CaseNote',
  INVOICE: 'Invoice',
} as const

export type AuditEntityType = (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY]
