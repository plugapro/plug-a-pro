export type SaIdValidationResult =
  | {
      ok: true
      normalized: string
      dateOfBirth: Date
      gender: 'female' | 'male'
      citizenship: 'citizen' | 'permanent_resident'
    }
  | { ok: false; reason: 'format' | 'date_of_birth' | 'checksum' }

export type PassportValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: 'format' }

export function validateSaId(raw: string): SaIdValidationResult {
  const digits = raw.replace(/\s+/g, '')
  if (!/^\d{13}$/.test(digits)) {
    return { ok: false, reason: 'format' }
  }

  const dateOfBirth = parseSaIdDateOfBirth(digits.slice(0, 6))
  if (!dateOfBirth) {
    return { ok: false, reason: 'date_of_birth' }
  }

  const citizenshipDigit = digits[10]
  if (citizenshipDigit !== '0' && citizenshipDigit !== '1') {
    return { ok: false, reason: 'format' }
  }

  if (!luhnCheck(digits)) {
    return { ok: false, reason: 'checksum' }
  }

  const genderSequence = Number.parseInt(digits.slice(6, 10), 10)

  return {
    ok: true,
    normalized: digits,
    dateOfBirth,
    gender: genderSequence < 5000 ? 'female' : 'male',
    citizenship: citizenshipDigit === '0' ? 'citizen' : 'permanent_resident',
  }
}

export function validatePassportNumber(raw: string): PassportValidationResult {
  const trimmed = raw.trim()
  if (/\s/.test(trimmed)) {
    return { ok: false, reason: 'format' }
  }

  if (
    trimmed.length >= 6 &&
    trimmed.length <= 30 &&
    /^[a-z0-9]+$/i.test(trimmed) &&
    /[a-z]/i.test(trimmed)
  ) {
    return { ok: true, normalized: trimmed.toUpperCase() }
  }

  return { ok: false, reason: 'format' }
}

export function getIdentifierLast4(value: string): string {
  return value.trim().slice(-4)
}

function parseSaIdDateOfBirth(yymmdd: string): Date | null {
  const yy = Number.parseInt(yymmdd.slice(0, 2), 10)
  const mm = Number.parseInt(yymmdd.slice(2, 4), 10)
  const dd = Number.parseInt(yymmdd.slice(4, 6), 10)
  const currentYear = new Date().getUTCFullYear()
  const currentCentury = Math.floor(currentYear / 100) * 100
  const currentYearTwoDigits = currentYear % 100
  const fullYear = yy <= currentYearTwoDigits ? currentCentury + yy : currentCentury - 100 + yy
  const date = new Date(Date.UTC(fullYear, mm - 1, dd))

  if (
    date.getUTCFullYear() !== fullYear ||
    date.getUTCMonth() !== mm - 1 ||
    date.getUTCDate() !== dd
  ) {
    return null
  }

  return date
}

// Standard Luhn check (rightmost digit = position 1, not doubled).
function luhnCheck(num: string): boolean {
  let sum = 0
  let doubleDigit = false

  for (let i = num.length - 1; i >= 0; i--) {
    let digit = Number.parseInt(num[i], 10)
    if (doubleDigit) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleDigit = !doubleDigit
  }

  return sum % 10 === 0
}
