import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Public - resolves an 8-char reference suffix and issues a server-side redirect.
// The customerAccessToken is NEVER exposed to the caller — not in the response body
// and not in the Location header. Trackable requests redirect to the session-gated
// /requests/[id] page, which sends unauthenticated visitors to /sign-in.
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

  const bookingId = jobRequest.match?.booking?.id ?? null

  // Redirect server-side to session-gated pages. The bearer token is never placed in
  // the response body or the Location header.
  // Prefer the booking route when available; otherwise the session-gated request page.
  if (bookingId) {
    return NextResponse.redirect(new URL(`/bookings/${bookingId}`, req.nextUrl.origin), 302)
  }

  // /requests/[id] requires a customer session and redirects unauthenticated visitors
  // to /sign-in, so the token never has to appear anywhere in the response.
  return NextResponse.redirect(new URL(`/requests/${jobRequest.id}`, req.nextUrl.origin), 302)
}
