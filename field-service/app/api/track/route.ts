import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Public - resolves an 8-char reference suffix and issues a server-side redirect.
// The customerAccessToken is NEVER returned in the response body; it is used only
// to construct the redirect URL so it travels as a path segment in the Location
// header rather than being exposed as JSON to the caller.
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')?.trim().toUpperCase()
  if (!ref || ref.length < 6) {
    return NextResponse.json({ error: 'ref required' }, { status: 400 })
  }

  // Match against the last N chars of JobRequest.id (case-insensitive)
  const jobRequest = await db.jobRequest.findFirst({
    where: {
      id: { endsWith: ref.toLowerCase() },
      customerAccessToken: { not: null },
      customerAccessTokenRevokedAt: null,
    },
    select: {
      id: true,
      status: true,
      category: true,
      customerAccessToken: true,
      customerAccessTokenExpiresAt: true,
      match: {
        select: {
          booking: { select: { id: true } },
        },
      },
    },
  })

  if (!jobRequest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // If token is expired, still redirect - the access page handles expiry gracefully
  const bookingId = jobRequest.match?.booking?.id ?? null

  // Redirect server-side so the bearer token is never exposed in the API response body.
  // Prefer the booking route when available; fall back to the ticket access page.
  if (bookingId) {
    return NextResponse.redirect(new URL(`/bookings/${bookingId}`, req.nextUrl.origin), 302)
  }

  if (jobRequest.customerAccessToken) {
    return NextResponse.redirect(
      new URL(`/requests/access/${encodeURIComponent(jobRequest.customerAccessToken)}`, req.nextUrl.origin),
      302,
    )
  }

  return NextResponse.json({ error: 'not found' }, { status: 404 })
}
