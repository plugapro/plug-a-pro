export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { AutoRefresh } from '@/components/customer/AutoRefresh'

export const metadata = buildMetadata({ title: 'Message Thread' })

export default async function MessageThreadPage({
  params,
}: {
  params: Promise<{ bookingId: string }>
}) {
  const { bookingId } = await params

  const session = await getSession()
  if (!session) redirect(`/sign-in?next=/messages/${bookingId}`)

  const flagEnabled = await isEnabled('customer.messaging.v1', { userId: session.id })
  if (!flagEnabled) redirect('/bookings')

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) redirect('/sign-in')

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      match: {
        include: {
          jobRequest: { select: { customerId: true, category: true } },
          provider: { select: { id: true, name: true, phone: true } },
        },
      },
      messages: {
        where: { status: { not: 'QUEUED' } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          direction: true,
          body: true,
          status: true,
          createdAt: true,
        },
      },
    },
  })

  if (!booking) notFound()
  if (booking.match.jobRequest.customerId !== customer.id) redirect('/messages')

  const provider = booking.match.provider
  const canSend = booking.status === 'SCHEDULED' || booking.status === 'RESCHEDULED'

  async function sendMessage(formData: FormData) {
    'use server'
    const { getSession: getSess } = await import('@/lib/auth')
    const sess = await getSess()
    if (!sess) redirect(`/sign-in?next=/messages/${bookingId}`)

    const { resolveCustomerForSession: resolveCust } = await import('@/lib/customer-session')
    const { db: database } = await import('@/lib/db')
    const cust = await resolveCust(database, sess)
    if (!cust) redirect('/sign-in')

    const freshBooking = await database.booking.findUnique({
      where: { id: bookingId },
      include: {
        match: {
          include: {
            jobRequest: { select: { customerId: true, category: true } },
            provider: { select: { phone: true, name: true } },
          },
        },
      },
    })
    if (!freshBooking || freshBooking.match.jobRequest.customerId !== cust.id) redirect('/messages')
    if (freshBooking.status !== 'SCHEDULED' && freshBooking.status !== 'RESCHEDULED') redirect(`/messages/${bookingId}`)

    const body = String(formData.get('body') ?? '').trim()
    if (!body || body.length < 2 || body.length > 1000) redirect(`/messages/${bookingId}`)

    // Rate limit: max 5 messages per booking per minute
    const oneMinuteAgo = new Date(Date.now() - 60_000)
    const recentCount = await database.messageEvent.count({
      where: {
        bookingId,
        direction: 'OUTBOUND',
        createdAt: { gte: oneMinuteAgo },
      },
    })
    if (recentCount >= 5) redirect(`/messages/${bookingId}`)

    const providerPhone = freshBooking.match.provider?.phone
    if (!providerPhone) redirect(`/messages/${bookingId}`)

    // Pre-create QUEUED row so rate-limit counter increments even when sendText fails.
    // logOutboundMessage (inside sendText) creates a SENT row on success; the QUEUED row
    // is filtered from the thread display (where: { status: { not: 'QUEUED' } } above).
    const messageText = `Message from customer (Booking #${bookingId.slice(-8).toUpperCase()}):\n\n${body}`
    await database.messageEvent.create({
      data: {
        bookingId,
        customerId: cust.id,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        body: messageText,
        to: providerPhone,
        templateName: 'freeform:customer_message',
        status: 'QUEUED',
        metadata: { sentByCustomerId: cust.id },
      },
    })

    const { sendText } = await import('@/lib/whatsapp')
    await sendText({
      to: providerPhone,
      text: messageText,
      bookingId,
      templateName: 'freeform:customer_message',
      metadata: { sentByCustomerId: cust.id },
    }).catch((err: unknown) => {
      console.error('[messages] send failed', err)
    })

    redirect(`/messages/${bookingId}`)
  }

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <AutoRefresh terminalState={!canSend} />

      <div>
        <Link href="/messages" className="text-xs text-muted-foreground hover:text-foreground">
          ← Messages
        </Link>
        <h1 className="text-xl font-semibold mt-1">
          {booking.match.jobRequest.category} — {provider?.name ?? 'Provider'}
        </h1>
        <p className="text-xs text-muted-foreground font-mono">#{bookingId.slice(-8).toUpperCase()}</p>
      </div>

      {/* Thread */}
      <div className="space-y-3">
        {booking.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No messages yet. Send a message to your provider below.
          </p>
        ) : (
          booking.messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-xl p-3 text-sm max-w-xs ${
                msg.direction === 'OUTBOUND'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
            >
              <p>{msg.body ?? '(no content)'}</p>
              <p className={`text-xs mt-1 ${msg.direction === 'OUTBOUND' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                {msg.createdAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Send form */}
      {canSend ? (
        <form action={sendMessage} className="space-y-3">
          <textarea
            name="body"
            rows={3}
            required
            minLength={2}
            maxLength={1000}
            placeholder="Type your message…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" className="w-full">Send message</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground text-center">
          Messaging is only available for scheduled bookings.
        </p>
      )}
    </div>
  )
}
