// ─── Customer: Rate booking ────────────────────────────────────────────────────
// Simple 1-5 star rating with optional comment. One rating per booking.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

export const metadata = buildMetadata({ title: 'Rate your experience', noIndex: true })

export default async function RatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  const { id } = await params

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, userId: true } },
      service:  { select: { name: true } },
    },
  })

  if (!booking) notFound()
  if (booking.customer.userId !== session.id) redirect('/bookings')
  if (booking.status !== 'COMPLETED') redirect(`/bookings/${id}`)

  // Already rated — redirect back
  const existing = await db.rating.findUnique({ where: { bookingId: id } })
  if (existing) redirect(`/bookings/${id}`)

  async function submitRating(formData: FormData) {
    'use server'
    const score   = Number(formData.get('score'))
    const comment = String(formData.get('comment') ?? '').trim() || null

    if (!score || score < 1 || score > 5) return

    await db.rating.create({
      data: {
        bookingId:  id,
        customerId: booking!.customer.id,
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
          <p className="mt-1 text-sm text-muted-foreground">{booking.service.name}</p>
        </div>

        <form action={submitRating} className="space-y-5">
          {/* Star selector */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Your rating</legend>
            <div className="flex gap-3 justify-center">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="cursor-pointer">
                  <input
                    type="radio"
                    name="score"
                    value={n}
                    required
                    className="sr-only peer"
                  />
                  <span className="text-3xl select-none peer-checked:scale-110 transition-transform block">
                    ★
                  </span>
                </label>
              ))}
            </div>
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
