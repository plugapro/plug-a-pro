// ─── Customer: Rate booking ────────────────────────────────────────────────────
// Simple 1-5 star rating with optional comment. One rating per booking.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { StarRating } from '@/components/customer/StarRating'

export const metadata = buildMetadata({ title: 'Rate your experience', noIndex: true })

export default async function RatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/bookings/${id}/rate`)}`)

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              customer: { select: { id: true } },
            },
          },
        },
      },
      job: { select: { id: true, providerId: true } },
    },
  })

  if (!booking) notFound()

  const bookingCustomerId = booking.match.jobRequest.customer.id
  const customer = await resolveCustomerForSession(db, session)
  if (!customer || bookingCustomerId !== customer.id) redirect('/bookings')
  if (booking.status !== 'COMPLETED') redirect(`/bookings/${id}`)
  if (!booking.job) redirect(`/bookings/${id}`)

  const jobId = booking.job.id
  const jobProviderId = booking.job.providerId

  // Already rated — redirect back
  const existing = await db.review.findFirst({
    where: { jobId, reviewerType: 'CUSTOMER' },
  })
  if (existing) redirect(`/bookings/${id}`)

  const category = booking.match.jobRequest.category

  async function submitRating(formData: FormData) {
    'use server'
    const { getSession: getServerSession } = await import('@/lib/auth')
    const { db: dbServer } = await import('@/lib/db')
    const { resolveCustomerForSession: resolveCustomer } = await import('@/lib/customer-session')

    const activeSession = await getServerSession()
    if (!activeSession) redirect(`/sign-in?next=${encodeURIComponent(`/bookings/${id}/rate`)}`)

    const activeCustomer = await resolveCustomer(dbServer, activeSession)
    if (!activeCustomer || activeCustomer.id !== bookingCustomerId) redirect('/bookings')

    const score   = Number(formData.get('score'))
    const comment = String(formData.get('comment') ?? '').trim() || null

    if (!score || score < 1 || score > 5) return

    const existingReview = await dbServer.review.findFirst({
      where: { jobId, reviewerType: 'CUSTOMER' },
      select: { id: true },
    })
    if (existingReview) redirect(`/bookings/${id}`)

    await dbServer.review.create({
      data: {
        jobId,
        reviewerType: 'CUSTOMER',
        customerId:   activeCustomer.id,
        score,
        comment,
      },
    })

    redirect(`/bookings/${id}`)
  }

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">How was your experience?</h1>
          <p className="mt-1 text-sm text-muted-foreground capitalize">{category}</p>
        </div>

        <form action={submitRating} className="space-y-5">
          {/* Star selector */}
          <fieldset className="space-y-3">
            <legend className="block text-center text-sm font-medium">
              Your rating
            </legend>
            <StarRating name="score" required />
          </fieldset>

          {/* Comment */}
          <div className="space-y-1">
            <Label htmlFor="comment">
              Comment <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="comment"
              name="comment"
              rows={3}
              placeholder="Tell us about your experience…"
              className="resize-none"
            />
          </div>

          <Button type="submit" className="w-full" size="lg">
            Submit rating
          </Button>
        </form>

        <Button asChild variant="ghost" className="w-full text-xs text-muted-foreground">
          <a href={`/bookings/${id}`}>Skip</a>
        </Button>
      </div>
    </div>
  )
}
