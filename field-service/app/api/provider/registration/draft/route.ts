import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createApiReferenceId } from '@/lib/api-response'
import { db } from '@/lib/db'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import {
  ProviderRegistrationValidationError,
  saveProviderRegistrationDraft,
} from '@/lib/provider-registration/pwa-flow'
import { timestamp } from '@/lib/support-diagnostics'

const SURFACE = 'provider_registration_draft'

function categoryFor(status: number) {
  if (status === 401) return 'authentication'
  if (status === 403) return 'authorization'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'internal'
  return 'validation'
}

function suggestedActionsFor(status: number) {
  if (status === 401) return ['Verify your mobile number and try again.']
  if (status === 403) return ['Use the mobile number verified for this registration.']
  if (status >= 500) return ['Retry later or contact support with the reference ID.']
  return ['Review the registration details and try again.']
}

function errorResponse(code: string, message: string, status: number) {
  const referenceId = createApiReferenceId()
  return NextResponse.json(
    {
      ok: false,
      code,
      message,
      error: {
        code,
        category: categoryFor(status),
        message,
        reference_id: referenceId,
        referenceId,
        retryable: status === 429 || status >= 500,
        suggested_actions: suggestedActionsFor(status),
        context: { surface: SURFACE },
        timestamp: timestamp(),
      },
    },
    { status },
  )
}

async function requireVerifiedRegistrationSessionPhone(rawPhone: unknown) {
  const session = await getSession()
  if (!session?.phone) {
    throw new ProviderRegistrationValidationError(
      'Verify your mobile number before continuing.',
      'REGISTRATION_SESSION_REQUIRED',
      401,
    )
  }

  const requestedPhone = normalizeOtpPhoneNumber(typeof rawPhone === 'string' ? rawPhone : '', 'ZA')
  if (!requestedPhone.ok) {
    throw new ProviderRegistrationValidationError(requestedPhone.reason, requestedPhone.errorCode)
  }

  const sessionPhone = normalizeOtpPhoneNumber(session.phone, 'ZA')
  if (!sessionPhone.ok || sessionPhone.e164 !== requestedPhone.e164) {
    throw new ProviderRegistrationValidationError(
      'Use the mobile number you verified for this application.',
      'REGISTRATION_PHONE_MISMATCH',
      403,
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    await requireVerifiedRegistrationSessionPhone(body.phone)
    const result = await saveProviderRegistrationDraft(db, body)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof ProviderRegistrationValidationError) {
      return errorResponse(err.code, err.message, err.status)
    }
    return errorResponse('REGISTRATION_DRAFT_FAILED', 'Could not save your draft right now.', 500)
  }
}
