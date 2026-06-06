import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ProviderRegistrationValidationError,
  submitProviderRegistrationApplication,
} from '@/lib/provider-registration/pwa-flow'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await submitProviderRegistrationApplication(db, body)
    return NextResponse.json({ ok: true, ...result }, { status: result.outcome === 'created' ? 201 : 200 })
  } catch (err) {
    if (err instanceof ProviderRegistrationValidationError) {
      return NextResponse.json({ ok: false, code: err.code, message: err.message }, { status: err.status })
    }
    return NextResponse.json({ ok: false, code: 'REGISTRATION_SUBMIT_FAILED', message: 'Could not submit your application right now.' }, { status: 500 })
  }
}
