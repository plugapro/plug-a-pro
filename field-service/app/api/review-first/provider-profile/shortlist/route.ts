import { NextResponse } from 'next/server'
import { resolveReviewProviderProfileToken } from '@/lib/review-provider-profile-access'
import { shortlistProviderForCustomerReview } from '@/lib/review-first'

export async function POST(req: Request) {
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
