import { NextResponse, type NextRequest } from 'next/server'
import { getPaymentIntentStatus } from '@/app/(provider)/provider/credits/actions'

type RouteContext = {
  params: Promise<{ intentId: string }> | { intentId: string }
}

function isValidIntentId(intentId: string) {
  return /^[A-Za-z0-9_-]{6,80}$/.test(intentId)
}

function statusCodeFor(code: string) {
  switch (code) {
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'UNSUPPORTED_INTENT':
      return 400
    default:
      return 500
  }
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const startedAt = Date.now()
  const { intentId } = await context.params

  if (!isValidIntentId(intentId)) {
    return NextResponse.json(
      { error: { code: 'INVALID_INTENT_ID', message: 'Payment intent id is invalid.' } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const result = await getPaymentIntentStatus(intentId)
  const durationMs = Date.now() - startedAt

  if (!result.ok) {
    console.warn('[provider-payment-intent-status] lookup_failed', { intentId, code: result.code, durationMs })
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: statusCodeFor(result.code), headers: { 'Cache-Control': 'no-store' } },
    )
  }

  console.info('[provider-payment-intent-status] lookup_succeeded', { intentId, status: result.status, durationMs })
  return NextResponse.json(
    { status: result.status, creditsIssued: result.creditsIssued },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
