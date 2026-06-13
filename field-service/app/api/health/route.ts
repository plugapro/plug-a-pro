import { NextResponse, type NextRequest } from 'next/server'
import { checkHealthProbeLimit } from '@/lib/rate-limit'
import { trustedClientIp } from '@/lib/request-ip'
import { runHealthChecks, toPublicHealthBody } from '@/lib/status/health-checks'

export const dynamic = 'force-dynamic'

export async function GET(request?: NextRequest) {
  const timestamp = new Date().toISOString()

  const ip = request ? trustedClientIp(request) : null
  const probeLimit = await checkHealthProbeLimit({ ip })
  if (!probeLimit.ok) {
    return NextResponse.json(
      { status: 'rate_limited', timestamp },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(probeLimit.retryAfterMs / 1000)) } },
    )
  }

  const full = await runHealthChecks()
  const body = toPublicHealthBody(full)
  const httpStatus = full.ok ? 200 : 503
  return NextResponse.json(body, {
    status: httpStatus,
    headers: full.ok
      ? { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=45' }
      : { 'Cache-Control': 'no-store' },
  })
}
