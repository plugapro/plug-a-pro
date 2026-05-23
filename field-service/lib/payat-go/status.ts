export type InternalPayAtGoStatus =
  | 'PENDING'
  | 'SENT'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN'

export type PayAtGoAccountState =
  | 'PAYMENT_OUTSTANDING'
  | 'PROCESSING_PAYMENT'
  | 'PAYMENT_COMPLETED'
  | 'PARTIAL_PAYMENT_RECEIVED'
  | 'PAYMENT_FEES_ISSUE'
  | 'PAYMENT_READY_FOR_SETTLEMENT'
  | 'SETTLEMENT_PROCESSED'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_EXPIRED'
  | 'CANCELLED_DUE_TO_PRICING_PACKAGE_UPDATE'

/**
 * Explicit provider-to-internal status mapping based on the Pay@Go OpenAPI enum.
 */
export function mapPayAtGoAccountStateToInternalStatus(
  providerStatus: string | null | undefined,
): InternalPayAtGoStatus {
  const status = providerStatus?.trim().toUpperCase()
  switch (status) {
    case 'PAYMENT_OUTSTANDING':
      return 'SENT'
    case 'PROCESSING_PAYMENT':
    case 'PAYMENT_READY_FOR_SETTLEMENT':
      return 'PENDING'
    case 'PAYMENT_COMPLETED':
    case 'SETTLEMENT_PROCESSED':
      return 'PAID'
    case 'PARTIAL_PAYMENT_RECEIVED':
    case 'PAYMENT_FEES_ISSUE':
      return 'FAILED'
    case 'PAYMENT_CANCELLED':
    case 'CANCELLED_DUE_TO_PRICING_PACKAGE_UPDATE':
      return 'CANCELLED'
    case 'PAYMENT_EXPIRED':
      return 'EXPIRED'
    default:
      return 'UNKNOWN'
  }
}
