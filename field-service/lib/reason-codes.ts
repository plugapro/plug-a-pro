// ─── Reason-code registry ─────────────────────────────────────────────────────
// Per-queue close-out codes. Every list includes OTHER - callers must enforce
// a free-text note when code === 'OTHER'.
//
// Deprecation: mark a code inactive via the `deprecated` flag.
// Do NOT delete codes - historical cases reference them.

import type { OpsQueueType } from '@prisma/client'

export interface ReasonCode {
  code: string
  label: string
  requiresNote: boolean    // always true for OTHER; true for any code needing elaboration
  deprecated?: boolean
}

// ─── Per-queue codes ──────────────────────────────────────────────────────────

export const DISPATCH_REASON_CODES: ReasonCode[] = [
  { code: 'COVERAGE_GAP',           label: 'No providers in area',         requiresNote: false },
  { code: 'DUPLICATE_REQUEST',      label: 'Duplicate request',            requiresNote: false },
  { code: 'CUSTOMER_CANCELLED',     label: 'Customer cancelled',           requiresNote: false },
  { code: 'FRAUD_SUSPECTED',        label: 'Fraud suspected',              requiresNote: true  },
  { code: 'PROVIDER_UNRESPONSIVE',  label: 'Provider unresponsive',        requiresNote: false },
  { code: 'OUT_OF_SCOPE',           label: 'Out of service scope',         requiresNote: false },
  { code: 'OTHER',                  label: 'Other',                        requiresNote: true  },
]

export const FIELD_EXCEPTION_REASON_CODES: ReasonCode[] = [
  { code: 'PROVIDER_NO_SHOW',         label: 'Provider no-show',           requiresNote: false },
  { code: 'CUSTOMER_NO_SHOW',         label: 'Customer no-show',           requiresNote: false },
  { code: 'SITE_ACCESS_BLOCKED',      label: 'Site access blocked',        requiresNote: false },
  { code: 'ADDITIONAL_SCOPE_REQUIRED',label: 'Additional scope required',  requiresNote: true  },
  { code: 'EQUIPMENT_MISSING',        label: 'Equipment / parts missing',  requiresNote: false },
  { code: 'OTHER',                    label: 'Other',                      requiresNote: true  },
]

export const VALIDATION_REASON_CODES: ReasonCode[] = [
  { code: 'INSUFFICIENT_INFO',  label: 'Insufficient information',  requiresNote: false },
  { code: 'DUPLICATE',          label: 'Duplicate request',         requiresNote: false },
  { code: 'WRONG_CATEGORY',     label: 'Wrong service category',    requiresNote: false },
  { code: 'SPAM',               label: 'Spam / test request',       requiresNote: false },
  { code: 'OTHER',              label: 'Other',                     requiresNote: true  },
]

export const QUOTE_REASON_CODES: ReasonCode[] = [
  { code: 'CUSTOMER_DECLINED',  label: 'Customer declined quote',   requiresNote: false },
  { code: 'EXPIRED',            label: 'Quote expired',             requiresNote: false },
  { code: 'PRICE_DISPUTE',      label: 'Price dispute',             requiresNote: true  },
  { code: 'SCOPE_CHANGE',       label: 'Scope change',              requiresNote: true  },
  { code: 'OTHER',              label: 'Other',                     requiresNote: true  },
]

export const TRUST_REASON_CODES: ReasonCode[] = [
  { code: 'RESOLVED_REFUND',     label: 'Resolved - refund issued',      requiresNote: false },
  { code: 'RESOLVED_REDO',       label: 'Resolved - redo arranged',      requiresNote: false },
  { code: 'RESOLVED_NO_ACTION',  label: 'Resolved - no action required', requiresNote: true  },
  { code: 'ESCALATED_LEGAL',     label: 'Escalated to legal',            requiresNote: true  },
  { code: 'OTHER',               label: 'Other',                         requiresNote: true  },
]

export const FINANCE_REASON_CODES: ReasonCode[] = [
  { code: 'REFUND_ISSUED',        label: 'Refund issued',           requiresNote: false },
  { code: 'RETRIED_OK',           label: 'Payment retry succeeded', requiresNote: false },
  { code: 'WRITTEN_OFF',          label: 'Written off',             requiresNote: true  },
  { code: 'CUSTOMER_CONTACTED',   label: 'Customer contacted',      requiresNote: false },
  { code: 'OTHER',                label: 'Other',                   requiresNote: true  },
]

// TODO(WS-SUPPLY): SUPPLY queue not yet in OpsQueueType enum - add migration + enum member
// before registering this in QUEUE_REASON_CODES. Exported here so it can be imported
// directly when the SUPPLY queue page is built.
export const SUPPLY_REASON_CODES: ReasonCode[] = [
  { code: 'PROVIDER_RECRUITED',   label: 'New provider recruited',  requiresNote: false },
  { code: 'AREA_DEPRIORITISED',   label: 'Area deprioritised',      requiresNote: true  },
  { code: 'REFERRED_TO_PARTNER',  label: 'Referred to partner',     requiresNote: false },
  { code: 'OTHER',                label: 'Other',                   requiresNote: true  },
]

// ─── Index by queue type ──────────────────────────────────────────────────────

const QUEUE_REASON_CODES: Partial<Record<OpsQueueType, ReasonCode[]>> = {
  DISPATCH:           DISPATCH_REASON_CODES,
  FIELD_EXCEPTION:    FIELD_EXCEPTION_REASON_CODES,
  VALIDATION:         VALIDATION_REASON_CODES,
  QUOTE_APPROVAL:     QUOTE_REASON_CODES,
  DISPUTE:            TRUST_REASON_CODES,
  PAYMENT_FOLLOW_UP:  FINANCE_REASON_CODES,
  PROVIDER_ONBOARDING: [
    { code: 'APPROVED',           label: 'Application approved',    requiresNote: false },
    { code: 'REJECTED_INCOMPLETE',label: 'Rejected - incomplete',   requiresNote: true  },
    { code: 'REJECTED_INELIGIBLE',label: 'Rejected - ineligible',   requiresNote: true  },
    { code: 'OTHER',              label: 'Other',                   requiresNote: true  },
  ],
  IDENTITY_VERIFICATION: [
    { code: 'APPROVED',           label: 'Identity approved',       requiresNote: false },
    { code: 'RETRY_REQUIRED',     label: 'Retry requested',         requiresNote: true  },
    { code: 'REJECTED',           label: 'Identity rejected',       requiresNote: true  },
    { code: 'OTHER',              label: 'Other',                   requiresNote: true  },
  ],
}

export function getReasonCodesForQueue(queueType: OpsQueueType): ReasonCode[] {
  return (QUEUE_REASON_CODES[queueType] ?? []).filter((c) => !c.deprecated)
}

export function getReasonCode(
  queueType: OpsQueueType,
  code: string,
): ReasonCode | undefined {
  return getReasonCodesForQueue(queueType).find((c) => c.code === code)
}

/** Returns true when a free-text note is required for this code. */
export function noteRequiredForCode(queueType: OpsQueueType, code: string): boolean {
  return getReasonCode(queueType, code)?.requiresNote ?? false
}

/**
 * Returns true when `code` is a valid (non-deprecated) close-out reason for the
 * given queue. Server actions receive the reason code from attacker-controlled
 * form fields, so the code MUST be validated against the case's queue before a
 * resolution is written.
 */
export function isValidReasonCode(queueType: OpsQueueType, code: string): boolean {
  return getReasonCode(queueType, code) !== undefined
}
