import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    otpDeliveryAttempt: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('@/lib/audit', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}))

import { sendTemplate } from '@/lib/whatsapp'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/audit'
import { deliverOtp, OtpDeliveryError } from '@/lib/otp-delivery'

const TEST_OTP = '987654' // digits do not appear in +27821234567
const TEST_PHONE_RAW = '0821234567'
const TEST_PHONE_E164 = '+27821234567'

const consoleSpies = {
  info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
}

beforeEach(() => {
  vi.clearAllMocks()
  consoleSpies.info.mockClear()
  consoleSpies.warn.mockClear()
  consoleSpies.error.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('deliverOtp', () => {
  it('sends the OTP via the otp_login template and records a sent attempt + audit', async () => {
    vi.mocked(sendTemplate).mockResolvedValueOnce('wamid.HBgL12345')

    const result = await deliverOtp({
      phone: TEST_PHONE_RAW,
      code: TEST_OTP,
      context: { userId: 'u1', hookRequestId: 'r1' },
    })

    expect(result).toEqual({
      ok: true,
      whatsappMessageId: 'wamid.HBgL12345',
      phoneE164: TEST_PHONE_E164,
    })

    expect(sendTemplate).toHaveBeenCalledTimes(1)
    const sendArg = vi.mocked(sendTemplate).mock.calls[0]![0]
    expect(sendArg.to).toBe(TEST_PHONE_E164)
    expect(sendArg.template).toBe('otp_login')
    expect(sendArg.allowTestCohortOverride).toBe(true)
    expect(sendArg.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: TEST_OTP }] },
      {
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [{ type: 'text', text: TEST_OTP }],
      },
    ])

    expect(db.otpDeliveryAttempt.create).toHaveBeenCalledTimes(1)
    const createArg = vi.mocked(db.otpDeliveryAttempt.create).mock.calls[0]![0]
    expect(createArg.data.status).toBe('sent')
    expect(createArg.data.whatsappMessageId).toBe('wamid.HBgL12345')
    expect(createArg.data.phoneE164).toBe(TEST_PHONE_E164)
    expect(createArg.data.templateName).toBe('otp_login')

    expect(recordAuditLog).toHaveBeenCalledTimes(1)
    const auditArg = vi.mocked(recordAuditLog).mock.calls[0]![0]
    expect(auditArg.action).toBe('auth.otp_send')
    expect(auditArg.entityId).toBe(TEST_PHONE_E164)
  })

  it('rejects non-ZA phone numbers with UNSUPPORTED_COUNTRY_CODE without calling WhatsApp', async () => {
    await expect(
      deliverOtp({ phone: '+15555550100', code: TEST_OTP }),
    ).rejects.toBeInstanceOf(OtpDeliveryError)

    expect(sendTemplate).not.toHaveBeenCalled()
    expect(db.otpDeliveryAttempt.create).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(db.otpDeliveryAttempt.create).mock.calls[0]![0].data.status,
    ).toBe('failed')
  })

  it('classifies a TEMPLATE_NOT_APPROVED error from sendTemplate', async () => {
    vi.mocked(sendTemplate).mockRejectedValueOnce(
      new Error('[TEMPLATE_NOT_APPROVED] Template "otp_login" is not approved. code=132001'),
    )

    let caught: OtpDeliveryError | null = null
    try {
      await deliverOtp({
        phone: TEST_PHONE_RAW,
        code: TEST_OTP,
        context: { hookRequestId: 'r1' },
      })
    } catch (err) {
      caught = err as OtpDeliveryError
    }

    expect(caught).toBeInstanceOf(OtpDeliveryError)
    expect(caught?.code).toBe('TEMPLATE_NOT_APPROVED')
    expect(db.otpDeliveryAttempt.create).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(db.otpDeliveryAttempt.create).mock.calls[0]![0].data.status,
    ).toBe('failed')
    expect(
      vi.mocked(db.otpDeliveryAttempt.create).mock.calls[0]![0].data.failureCode,
    ).toBe('TEMPLATE_NOT_APPROVED')

    expect(recordAuditLog).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordAuditLog).mock.calls[0]![0].action).toBe('auth.otp_send_failed')
  })

  it('classifies a generic WhatsApp upstream error as WA_TRANSIENT', async () => {
    vi.mocked(sendTemplate).mockRejectedValueOnce(
      new Error('WhatsApp send failed: 500 upstream timeout'),
    )

    let caught: OtpDeliveryError | null = null
    try {
      await deliverOtp({ phone: TEST_PHONE_RAW, code: TEST_OTP })
    } catch (err) {
      caught = err as OtpDeliveryError
    }

    expect(caught?.code).toBe('WA_TRANSIENT')
  })

  it('never leaks the OTP value into logs, audit, or the persisted attempt row', async () => {
    vi.mocked(sendTemplate).mockResolvedValueOnce('wamid.HBgLleak1')
    await deliverOtp({
      phone: TEST_PHONE_RAW,
      code: TEST_OTP,
      context: { userId: 'u1', hookRequestId: 'r1' },
    })

    const dbPayload = JSON.stringify(vi.mocked(db.otpDeliveryAttempt.create).mock.calls)
    expect(dbPayload).not.toContain(TEST_OTP)

    const auditPayload = JSON.stringify(vi.mocked(recordAuditLog).mock.calls)
    expect(auditPayload).not.toContain(TEST_OTP)

    for (const spy of [consoleSpies.info, consoleSpies.warn, consoleSpies.error]) {
      for (const call of spy.mock.calls) {
        const serialized = call
          .map((arg) =>
            typeof arg === 'string' ? arg : JSON.stringify(arg ?? null),
          )
          .join(' ')
        expect(serialized).not.toContain(TEST_OTP)
      }
    }
  })
})
