import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generatePublicErrorRef, captureApplicationError } from '../../lib/application-error-service'

vi.mock('../../lib/db', () => ({
  db: {
    applicationErrorEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

const { db } = await import('../../lib/db')

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── generatePublicErrorRef ───────────────────────────────────────────────────

describe('generatePublicErrorRef', () => {
  it('produces PAP-XXXXX format', () => {
    const ref = generatePublicErrorRef()
    expect(ref).toMatch(/^PAP-[A-Z2-9]{5}$/)
  })

  it('never contains ambiguous characters O, 0, I, or 1', () => {
    for (let i = 0; i < 200; i++) {
      const ref = generatePublicErrorRef()
      expect(ref).not.toMatch(/[OI01]/)
    }
  })

  it('generates distinct references across calls', () => {
    const refs = new Set(Array.from({ length: 50 }, generatePublicErrorRef))
    expect(refs.size).toBeGreaterThan(1)
  })
})

// ─── captureApplicationError ─────────────────────────────────────────────────

const baseInput = {
  traceId: 'provider_app_submit_test-trace-id',
  source: 'whatsapp',
  workflow: 'provider_application',
  step: 'submit',
  errorCode: 'PROVIDER_APPLICATION_DB_CONSTRAINT_FAILED',
  errorCategory: 'database_constraint',
  severity: 'error' as const,
  retryable: true,
}

describe('captureApplicationError — user-safe output', () => {
  it('user message never contains the raw error code', async () => {
    const { userMessage } = await captureApplicationError(baseInput)
    expect(userMessage).not.toContain('PROVIDER_APPLICATION_DB_CONSTRAINT_FAILED')
  })

  it('user message never contains the internal trace ID', async () => {
    const { userMessage } = await captureApplicationError(baseInput)
    expect(userMessage).not.toContain('provider_app_submit_test-trace-id')
  })

  it('user message never contains a Prisma error code', async () => {
    const { userMessage } = await captureApplicationError({
      ...baseInput,
      technicalMessage: 'Unique constraint failed on fields: (requestId)',
      metadata: { prisma_code: 'P2002', db_constraint: 'provider_applications_phone_key' },
    })
    expect(userMessage).not.toContain('P2002')
    expect(userMessage).not.toContain('provider_applications_phone_key')
  })

  it('public ref in returned result matches PAP-XXXXX format', async () => {
    const { publicRef } = await captureApplicationError(baseInput)
    expect(publicRef).toMatch(/^PAP-[A-Z2-9]{5}$/)
  })

  it('public ref appears in user message', async () => {
    const { publicRef, userMessage } = await captureApplicationError(baseInput)
    expect(userMessage).toContain(publicRef)
  })

  it('user message tells the user to contact support with the reference', async () => {
    const { userMessage } = await captureApplicationError(baseInput)
    expect(userMessage).toMatch(/contact support/i)
  })
})

describe('captureApplicationError — internal storage', () => {
  it('persists the full error code internally', async () => {
    await captureApplicationError(baseInput)
    expect(db.applicationErrorEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorCode: 'PROVIDER_APPLICATION_DB_CONSTRAINT_FAILED' }),
      }),
    )
  })

  it('persists the trace ID internally', async () => {
    await captureApplicationError(baseInput)
    expect(db.applicationErrorEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ traceId: 'provider_app_submit_test-trace-id' }),
      }),
    )
  })

  it('stores a phone hash not the raw phone number', async () => {
    await captureApplicationError({ ...baseInput, whatsappPhone: '+27821234567' })
    const callData = (db.applicationErrorEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(callData.whatsappPhoneHash).toBeDefined()
    expect(callData.whatsappPhoneHash).not.toContain('+27821234567')
    expect(callData.whatsappPhoneHash).not.toContain('27821234567')
    expect(callData.whatsappPhoneHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('does not store phone at all when not provided', async () => {
    await captureApplicationError(baseInput)
    const callData = (db.applicationErrorEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(callData.whatsappPhoneHash).toBeNull()
  })
})

describe('captureApplicationError — payload redaction', () => {
  it('redacts phone field from request payload', async () => {
    await captureApplicationError({
      ...baseInput,
      requestPayload: { phone: '+27821234567', action: 'submit' },
    })
    const callData = (db.applicationErrorEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(callData.requestPayloadSummary).toMatchObject({ phone: '[REDACTED]', action: 'submit' })
  })

  it('redacts idnumber field from request payload', async () => {
    await captureApplicationError({
      ...baseInput,
      requestPayload: { idNumber: '9001015009087', name: 'Lovemore' },
    })
    const callData = (db.applicationErrorEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(callData.requestPayloadSummary).toMatchObject({ idNumber: '[REDACTED]', name: 'Lovemore' })
  })

  it('redacts identity verification document and biometric fields', async () => {
    await captureApplicationError({
      ...baseInput,
      requestPayload: {
        passport: 'A12345678',
        permitNumber: 'ASY-123',
        documentNumber: 'DOC-123',
        selfie: 'base64-image',
        livenessScore: 0.9,
        action: 'identity_upload',
      },
    })
    const callData = (db.applicationErrorEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(callData.requestPayloadSummary).toMatchObject({
      passport: '[REDACTED]',
      permitNumber: '[REDACTED]',
      documentNumber: '[REDACTED]',
      selfie: '[REDACTED]',
      livenessScore: '[REDACTED]',
      action: 'identity_upload',
    })
  })

  it('redacts authorization header from response payload', async () => {
    await captureApplicationError({
      ...baseInput,
      responsePayload: { authorization: 'Bearer abc123', status: 500 },
    })
    const callData = (db.applicationErrorEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(callData.responsePayloadSummary).toMatchObject({ authorization: '[REDACTED]', status: 500 })
  })

  it('preserves non-sensitive payload fields', async () => {
    await captureApplicationError({
      ...baseInput,
      requestPayload: { action: 'submit', step: 'reg_pending', selected_skills_count: 3 },
    })
    const callData = (db.applicationErrorEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(callData.requestPayloadSummary).toMatchObject({
      action: 'submit',
      step: 'reg_pending',
      selected_skills_count: 3,
    })
  })
})

describe('captureApplicationError — persistence failure is non-fatal', () => {
  it('still returns a valid publicRef and userMessage when DB write fails', async () => {
    ;(db.applicationErrorEvent.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Connection refused'),
    )
    const { publicRef, userMessage } = await captureApplicationError(baseInput)
    expect(publicRef).toMatch(/^PAP-[A-Z2-9]{5}$/)
    expect(userMessage).toContain(publicRef)
    expect(userMessage).not.toContain('Connection refused')
    expect(userMessage).not.toContain('PROVIDER_APPLICATION_DB_CONSTRAINT_FAILED')
  })
})
