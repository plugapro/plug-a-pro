export type ProviderOnboardingRateInput = {
  callOutFeeText?: string | null
  hourlyRateText?: string | null
}

export class ProviderOnboardingValidationError extends Error {
  constructor(
    public readonly code: 'INVALID_FEE',
    message: string,
  ) {
    super(message)
    this.name = 'ProviderOnboardingValidationError'
  }
}

function parseOptionalRandAmount(value?: string | null) {
  const trimmed = value?.trim()
  if (!trimmed) return null

  // Providers often type "R350" or "350.00" in WhatsApp; keep parsing strict
  // enough to reject prose while accepting common Rand formats.
  const normalised = trimmed.replace(/^r\s*/i, '').replace(/\s+/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) {
    throw new ProviderOnboardingValidationError(
      'INVALID_FEE',
      'Fee must be a number, for example 250 or R250.',
    )
  }

  const amount = Number(normalised)
  if (!Number.isFinite(amount) || amount < 0 || amount > 50_000) {
    throw new ProviderOnboardingValidationError(
      'INVALID_FEE',
      'Fee must be between R0 and R50,000.',
    )
  }

  return amount
}

export function validateProviderOnboardingRates(input: ProviderOnboardingRateInput) {
  return {
    callOutFee: parseOptionalRandAmount(input.callOutFeeText),
    hourlyRate: parseOptionalRandAmount(input.hourlyRateText),
  }
}

export function formatRandAmountForProviderOnboarding(amount: number | null | undefined) {
  if (amount == null) return 'Not set'
  return `R${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`
}
