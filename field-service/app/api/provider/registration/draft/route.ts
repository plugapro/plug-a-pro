import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ProviderRegistrationValidationError,
  saveProviderRegistrationDraft,
} from '@/lib/provider-registration/pwa-flow'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await saveProviderRegistrationDraft(db, body)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof ProviderRegistrationValidationError) {
      return NextResponse.json({ ok: false, code: err.code, message: err.message }, { status: err.status })
    }
    return NextResponse.json({ ok: false, code: 'REGISTRATION_DRAFT_FAILED', message: 'Could not save your draft right now.' }, { status: 500 })
  }
}
