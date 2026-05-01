export type OtpCountryCode = 'ZA'

export type PhoneNormalizationErrorCode =
  | 'INVALID_PHONE_NUMBER'
  | 'UNSUPPORTED_COUNTRY_CODE'

export type PhoneNormalizationResult =
  | {
      ok: true
      rawInput: string
      countryCode: OtpCountryCode
      dialCode: '+27'
      e164: string
      nationalNumber: string
    }
  | {
      ok: false
      rawInput: string
      countryCode: string
      errorCode: PhoneNormalizationErrorCode
      reason: string
    }

export const DEFAULT_OTP_COUNTRY: OtpCountryCode = 'ZA'
export const SUPPORTED_OTP_COUNTRIES: OtpCountryCode[] = ['ZA']

export function isSupportedOtpCountry(countryCode: string): countryCode is OtpCountryCode {
  return SUPPORTED_OTP_COUNTRIES.includes(countryCode.toUpperCase() as OtpCountryCode)
}

export function normalizeOtpPhoneNumber(
  rawInput: string,
  countryCode: string = DEFAULT_OTP_COUNTRY,
): PhoneNormalizationResult {
  const normalizedCountry = countryCode.toUpperCase()
  const raw = rawInput.trim()

  if (!isSupportedOtpCountry(normalizedCountry)) {
    return {
      ok: false,
      rawInput,
      countryCode: normalizedCountry,
      errorCode: 'UNSUPPORTED_COUNTRY_CODE',
      reason: 'Only South African mobile numbers are enabled for worker portal OTP sign-in.',
    }
  }

  const stripped = raw.replace(/[\s\-().]/g, '')
  const digits = stripped.replace(/\D/g, '')
  let nationalNumber = ''

  if (stripped.startsWith('+')) {
    if (!stripped.startsWith('+27')) {
      return {
        ok: false,
        rawInput,
        countryCode: normalizedCountry,
        errorCode: 'UNSUPPORTED_COUNTRY_CODE',
        reason: 'Only South African mobile numbers are enabled for worker portal OTP sign-in.',
      }
    }
    nationalNumber = digits.slice(2)
  } else if (digits.startsWith('27')) {
    nationalNumber = digits.slice(2)
  } else if (digits.startsWith('0')) {
    nationalNumber = digits.slice(1)
  } else {
    nationalNumber = digits
  }

  if (!/^[678]\d{8}$/.test(nationalNumber)) {
    return {
      ok: false,
      rawInput,
      countryCode: normalizedCountry,
      errorCode: 'INVALID_PHONE_NUMBER',
      reason: 'Enter a valid South African mobile number.',
    }
  }

  return {
    ok: true,
    rawInput,
    countryCode: 'ZA',
    dialCode: '+27',
    e164: `+27${nationalNumber}`,
    nationalNumber,
  }
}
