import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { buildSessionCookieHeader } from '@/lib/auth-session-cookie'
import {
  clearPendingStepUpCookieHeader,
  decryptPendingStepUpCookie,
  STEP_UP_COOKIE_NAME,
} from '@/lib/otp-security-crypto'
import { completeStepUp } from '@/lib/otp-security'

function invalidStepUpResponse() {
  const response = NextResponse.json(
    { ok: false, restartSignIn: true },
    { status: 401 },
  )
  response.headers.set('Set-Cookie', clearPendingStepUpCookieHeader())
  return response
}

export async function POST() {
  const cookieStore = await cookies()
  const pending = cookieStore.get(STEP_UP_COOKIE_NAME)?.value

  if (!pending) return invalidStepUpResponse()

  const decrypted = decryptPendingStepUpCookie(pending)
  if (!decrypted.ok) return invalidStepUpResponse()

  let completion: Awaited<ReturnType<typeof completeStepUp>>
  try {
    completion = await completeStepUp(decrypted.payload.phoneE164, decrypted.payload.userId)
  } catch {
    return invalidStepUpResponse()
  }

  if (!completion.ok) return invalidStepUpResponse()

  const response = NextResponse.json({ ok: true })
  response.headers.append(
    'Set-Cookie',
    buildSessionCookieHeader(decrypted.payload.accessToken, decrypted.payload.maxAge),
  )
  response.headers.append('Set-Cookie', clearPendingStepUpCookieHeader())
  return response
}
