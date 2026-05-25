'use client'

import { useMemo, useState } from 'react'
import type { IdentityBasis } from '@/lib/identity-verification/types'
import {
  identityIdentifierHint,
  identityIdentifierLabel,
  requiresCountryDetails,
  requiresExpiry,
} from '@/lib/identity-verification/document-validation'

type IdentityDetailsFormProps = {
  action: (formData: FormData) => void | Promise<void>
  defaultIdentityBasis: IdentityBasis
  defaultIssuingCountry?: string | null
  defaultNationality?: string | null
  countryOptions: readonly string[]
}

const BASIS_OPTIONS: Array<{ value: IdentityBasis; label: string; help: string }> = [
  { value: 'SA_ID', label: 'South African ID', help: '13-digit SA ID number' },
  { value: 'PASSPORT', label: 'Passport', help: 'Passport photo-page details' },
  { value: 'REFUGEE_ID', label: 'Refugee ID', help: 'Refugee identity document' },
  { value: 'ASYLUM_PERMIT', label: 'Asylum permit', help: 'Section 22 permit' },
  { value: 'REFUGEE_PERMIT', label: 'Refugee permit', help: 'Section 24 permit' },
  { value: 'WORK_PERMIT', label: 'Work permit', help: 'Passport plus permit' },
  { value: 'PERMANENT_RESIDENCE_PERMIT', label: 'Permanent residence', help: 'Permanent residence permit' },
]

export function IdentityDetailsForm({
  action,
  defaultIdentityBasis,
  defaultIssuingCountry,
  defaultNationality,
  countryOptions,
}: IdentityDetailsFormProps) {
  const [identityBasis, setIdentityBasis] = useState<IdentityBasis>(defaultIdentityBasis)
  const showCountryFields = requiresCountryDetails(identityBasis)
  const showExpiry = requiresExpiry(identityBasis)
  const identifierLabel = identityIdentifierLabel(identityBasis)
  const identifierHint = identityIdentifierHint(identityBasis)
  const selectedOption = useMemo(
    () => BASIS_OPTIONS.find((option) => option.value === identityBasis) ?? BASIS_OPTIONS[0],
    [identityBasis],
  )

  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2">
        <label htmlFor="identityBasis" className="text-sm font-semibold">Choose document type</label>
        <select
          id="identityBasis"
          name="identityBasis"
          value={identityBasis}
          onChange={(event) => setIdentityBasis(event.target.value as IdentityBasis)}
          className="h-12 rounded-[14px] border bg-background px-3 text-sm font-semibold"
        >
          {BASIS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{selectedOption.help}</p>
      </div>

      <label className="grid gap-1.5 text-sm">
        <span className="font-semibold">{identifierLabel}</span>
        <input
          name="identifier"
          required
          inputMode={identityBasis === 'SA_ID' ? 'numeric' : 'text'}
          pattern={identityBasis === 'SA_ID' ? '\\d{13}' : '[A-Za-z0-9/-]{4,40}'}
          title={identifierHint}
          className="h-12 rounded-[14px] border bg-background px-3"
          autoComplete="off"
        />
        <span className="text-xs text-muted-foreground">{identifierHint}</span>
      </label>

      {showCountryFields ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Country of issue</span>
            <select
              name="issuingCountry"
              required
              defaultValue={defaultIssuingCountry ?? ''}
              className="h-12 rounded-[14px] border bg-background px-3 text-sm"
            >
              <option value="">Select country</option>
              {countryOptions.map((country) => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Nationality</span>
            <select
              name="nationality"
              required
              defaultValue={defaultNationality ?? ''}
              className="h-12 rounded-[14px] border bg-background px-3 text-sm"
            >
              <option value="">Select nationality</option>
              {countryOptions.map((country) => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {showExpiry ? (
        <label className="grid gap-1.5 text-sm">
          <span className="font-semibold">Expiry date</span>
          <input name="documentExpiryDate" type="date" required className="h-12 rounded-[14px] border bg-background px-3" />
          <span className="text-xs text-muted-foreground">Use a document that has not expired.</span>
        </label>
      ) : null}

      <div className="rounded-[16px] border bg-background/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
        Your details are encrypted and only used for provider verification.
      </div>

      <button className="min-h-12 rounded-[16px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
        Continue to document upload
      </button>
    </form>
  )
}
