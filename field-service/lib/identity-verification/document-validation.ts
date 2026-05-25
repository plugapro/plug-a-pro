import type { IdentityBasis } from './types'
import { validatePassportNumber, validateSaId } from './sa-id'

export type IdentityDocumentValidationInput = {
  identityBasis: IdentityBasis
  identifier: string
  issuingCountry?: string | null
  nationality?: string | null
  documentExpiryDate?: string | null
}

export type IdentityDocumentValidationResult =
  | {
      ok: true
      normalizedIdentifier: string
      issuingCountry: string | null
      nationality: string | null
      documentExpiryDate: Date | null
      dateOfBirth?: Date
      gender?: 'female' | 'male'
      citizenship?: 'citizen' | 'permanent_resident'
    }
  | {
      ok: false
      code:
        | 'INVALID_SA_ID'
        | 'COUNTRY_REQUIRED'
        | 'NATIONALITY_REQUIRED'
        | 'EXPIRY_REQUIRED'
        | 'EXPIRY_IN_PAST'
        | 'INVALID_IDENTIFIER'
      message: string
    }

const PASSPORT_PATTERNS: Record<string, { pattern: RegExp; hint: string }> = {
  'South Africa': { pattern: /^[A-Z]\d{8}$/i, hint: 'Use 1 letter followed by 8 digits.' },
  Botswana: { pattern: /^[A-Z]{1,2}\d{6,8}$/i, hint: 'Use the letters and digits exactly as shown in the passport.' },
  Eswatini: { pattern: /^[A-Z]{1,2}\d{6,8}$/i, hint: 'Use the letters and digits exactly as shown in the passport.' },
  Lesotho: { pattern: /^[A-Z]{1,2}\d{6,8}$/i, hint: 'Use the letters and digits exactly as shown in the passport.' },
  Mozambique: { pattern: /^[A-Z]{1,2}\d{6,8}$/i, hint: 'Use the letters and digits exactly as shown in the passport.' },
  Namibia: { pattern: /^[A-Z]{1,2}\d{6,8}$/i, hint: 'Use the letters and digits exactly as shown in the passport.' },
  Zimbabwe: { pattern: /^[A-Z]{1,2}\d{6,8}$/i, hint: 'Use the letters and digits exactly as shown in the passport.' },
}

export function validateIdentityDocumentDetails(
  input: IdentityDocumentValidationInput,
  now = new Date(),
): IdentityDocumentValidationResult {
  const issuingCountry = clean(input.issuingCountry)
  const nationality = clean(input.nationality)
  const expiry = parseExpiry(input.documentExpiryDate)

  if (input.identityBasis === 'SA_ID') {
    const validation = validateSaId(input.identifier)
    if (!validation.ok) {
      return {
        ok: false,
        code: 'INVALID_SA_ID',
        message: saIdMessage(validation.reason),
      }
    }

    return {
      ok: true,
      normalizedIdentifier: validation.normalized,
      issuingCountry: 'South Africa',
      nationality: 'South Africa',
      documentExpiryDate: null,
      dateOfBirth: validation.dateOfBirth,
      gender: validation.gender,
      citizenship: validation.citizenship,
    }
  }

  if (!issuingCountry) {
    return { ok: false, code: 'COUNTRY_REQUIRED', message: 'Select the country that issued this document.' }
  }
  if (!nationality) {
    return { ok: false, code: 'NATIONALITY_REQUIRED', message: 'Select the nationality shown on this document.' }
  }

  if (requiresExpiry(input.identityBasis)) {
    if (!expiry) {
      return { ok: false, code: 'EXPIRY_REQUIRED', message: 'Enter the document expiry date.' }
    }
    if (isBeforeToday(expiry, now)) {
      return { ok: false, code: 'EXPIRY_IN_PAST', message: 'Use a document that has not expired.' }
    }
  }

  const normalizedIdentifier = normalizeDocumentIdentifier(input.identityBasis, input.identifier)
  if (!normalizedIdentifier) {
    return {
      ok: false,
      code: 'INVALID_IDENTIFIER',
      message: identifierMessage(input.identityBasis),
    }
  }

  if (input.identityBasis === 'PASSPORT') {
    const countryPattern = PASSPORT_PATTERNS[issuingCountry]
    if (countryPattern && !countryPattern.pattern.test(normalizedIdentifier)) {
      return {
        ok: false,
        code: 'INVALID_IDENTIFIER',
        message: countryPattern.hint,
      }
    }
  }

  return {
    ok: true,
    normalizedIdentifier,
    issuingCountry,
    nationality,
    documentExpiryDate: expiry,
  }
}

export function identityIdentifierLabel(identityBasis: IdentityBasis): string {
  switch (identityBasis) {
    case 'SA_ID':
      return 'South African ID number'
    case 'PASSPORT':
      return 'Passport number'
    case 'REFUGEE_ID':
      return 'Refugee ID number'
    case 'ASYLUM_PERMIT':
      return 'Asylum seeker permit number'
    case 'REFUGEE_PERMIT':
      return 'Refugee permit number'
    case 'WORK_PERMIT':
      return 'Work permit number'
    case 'PERMANENT_RESIDENCE_PERMIT':
      return 'Permanent residence permit number'
  }
}

export function identityIdentifierHint(identityBasis: IdentityBasis): string {
  switch (identityBasis) {
    case 'SA_ID':
      return 'Enter the 13-digit number exactly as it appears on the ID.'
    case 'PASSPORT':
      return 'Use letters and numbers only, with no spaces.'
    default:
      return 'Use letters, numbers, slash, or hyphen only, with no spaces.'
  }
}

export function requiresCountryDetails(identityBasis: IdentityBasis): boolean {
  return identityBasis !== 'SA_ID'
}

export function requiresExpiry(identityBasis: IdentityBasis): boolean {
  return identityBasis !== 'SA_ID' && identityBasis !== 'REFUGEE_ID'
}

function normalizeDocumentIdentifier(identityBasis: IdentityBasis, identifier: string): string | null {
  if (identityBasis === 'PASSPORT') {
    const passport = validatePassportNumber(identifier)
    return passport.ok ? passport.normalized : null
  }

  const normalized = normalizeIdentifierValue(identifier)
  if (!/^[A-Z0-9/-]{4,40}$/.test(normalized)) return null
  return normalized
}

function normalizeIdentifierValue(input: string): string {
  return input.trim().toUpperCase()
}

function clean(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function parseExpiry(value?: string | null): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  const parsed = new Date(Date.UTC(year, month - 1, day))

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }

  return parsed
}

function isBeforeToday(date: Date, now: Date): boolean {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const expiry = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  return expiry < today
}

function saIdMessage(reason: 'format' | 'date_of_birth' | 'checksum'): string {
  switch (reason) {
    case 'date_of_birth':
      return 'The first 6 digits must be a real date of birth.'
    case 'checksum':
      return 'Check the ID number. The checksum does not match a valid South African ID.'
    case 'format':
    default:
      return 'Enter a valid 13-digit South African ID number.'
  }
}

function identifierMessage(identityBasis: IdentityBasis): string {
  return `${identityIdentifierLabel(identityBasis)} is not in a valid format.`
}
