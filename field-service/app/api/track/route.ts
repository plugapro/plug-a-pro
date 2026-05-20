import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Public - resolves an 8-char reference suffix to a customer access token or booking id
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

  return NextResponse.json({
    token: jobRequest.customerAccessToken,
    bookingId,
  })
}
