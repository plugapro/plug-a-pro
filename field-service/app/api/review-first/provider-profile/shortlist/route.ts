import { NextResponse } from 'next/server'
import { resolveReviewProviderProfileToken } from '@/lib/review-provider-profile-access'
import { shortlistProviderForCustomerReview } from '@/lib/review-first'

export async function POST(req: Request) {
  const reqOrigin = new URL(req.url).origin
  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  if (origin) {
    if (origin !== reqOrigin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (referer) {
    try {
      const refererOrigin = new URL(referer).origin
      if (refererOrigin !== reqOrigin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else {
    // Require at least Origin or Referer so cross-site form posts cannot pass.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const form = await req.formData()
  const token = String(form.get('token') ?? '')
  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }

  const resolved = await resolveReviewProviderProfileToken(token)
  if (resolved.status !== 'active' || !resolved.request || !resolved.provider) {
    return NextResponse.json({ error: 'Invalid or expired profile link' }, { status: 400 })
  }

  await shortlistProviderForCustomerReview({
    requestId: resolved.request.id,
    customerId: resolved.request.customerId,
    providerId: resolved.provider.id,
  })

  return NextResponse.redirect(
    new URL(`/provider-public-profile/${encodeURIComponent(token)}?shortlisted=1`, req.url),
    { status: 303 },
  )
}
