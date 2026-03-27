// ─── Admin: Dispatch ──────────────────────────────────────────────────────────
// Assign a technician to a CONFIRMED booking → creates Job → WhatsApp notification.
// Accessible directly or via ?bookingId= from the bookings table.

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export const metadata = buildMetadata({ title: 'Dispatch', noIndex: true })

// ─── Server Action ────────────────────────────────────────────────────────────

async function dispatchBooking(formData: FormData) {
  'use server'
  const session = await requireAdmin()
  const bookingId    = formData.get('bookingId') as string
  const technicianId = formData.get('technicianId') as string

  if (!bookingId || !technicianId) return

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { service: true, address: true, customer: true },
  })
  if (!booking || booking.status !== 'CONFIRMED') return

  const technician = await db.technician.findUnique({ where: { id: technicianId } })
  if (!technician) return

  // Create Job and link technician to booking
  await db.$transaction(async (tx) => {
    await tx.job.create({
      data: {
        bookingId,
        technicianId,
        status: 'ASSIGNED',
      },
    })
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        technicianId,
        status: 'SCHEDULED',
      },
    })
  })

  // Notify technician via WhatsApp
  const { notifyTechnicianNewJob } = await import('@/lib/whatsapp-bot')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const addressStr = `${booking.address.street}, ${booking.address.suburb}, ${booking.address.city}`
  const job = await db.job.findUnique({ where: { bookingId } })

  if (job) {
    await notifyTechnicianNewJob({
      technicianPhone: technician.phone,
      jobId: job.id,
      serviceName: booking.service.name,
      address: addressStr,
      scheduledWindow: `${booking.scheduledDate?.toLocaleDateString('en-ZA') ?? 'TBC'} ${booking.scheduledWindow ?? ''}`.trim(),
      customerInitial: booking.customer.name.split(' ')[0],
      bookingId,
    }).catch(console.error)
  }

  redirect('/admin/bookings?status=SCHEDULED')
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ bookingId?: string }>
}) {
  await requireAdmin()
  const { bookingId } = await searchParams

  // Load all CONFIRMED unassigned bookings
  const pendingBookings = await db.booking.findMany({
    where: { status: 'CONFIRMED', job: null },
    include: {
      customer: { select: { name: true, phone: true } },
      service:  { select: { name: true } },
      address:  { select: { street: true, suburb: true, city: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Selected booking (from ?bookingId= query param)
  const selected = bookingId
    ? pendingBookings.find((b) => b.id === bookingId) ?? null
    : pendingBookings[0] ?? null

  // Available technicians for selected booking's business
  const technicians = selected
    ? await db.technician.findMany({
        where: { businessId: selected.businessId, active: true },
        orderBy: { name: 'asc' },
      })
    : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dispatch</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Assign technicians to confirmed bookings
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Booking list */}
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Awaiting dispatch ({pendingBookings.length})
          </h2>
          {pendingBookings.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">
              No confirmed bookings awaiting dispatch.
            </p>
          )}
          {pendingBookings.map((b) => (
            <a
              key={b.id}
              href={`/admin/dispatch?bookingId=${b.id}`}
              className={cn(
                'block rounded-lg border p-3 hover:bg-accent transition-colors',
                selected?.id === b.id && 'border-foreground bg-accent'
              )}
            >
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-medium text-sm">{b.service.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.customer.name} · {b.address.suburb}
                  </p>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {b.id.slice(-6).toUpperCase()}
                </span>
              </div>
              {b.scheduledDate && (
                <p className="text-xs text-muted-foreground mt-1">
                  {b.scheduledDate.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {b.scheduledWindow ? ` · ${b.scheduledWindow}` : ''}
                </p>
              )}
            </a>
          ))}
        </div>

        {/* Assign form */}
        {selected && (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Assign technician
            </h2>

            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="font-medium">{selected.service.name}</p>
                <p className="text-sm text-muted-foreground">
                  {selected.customer.name} · {selected.customer.phone}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selected.address.street}, {selected.address.suburb}, {selected.address.city}
                </p>
                {selected.scheduledDate && (
                  <p className="text-sm">
                    {selected.scheduledDate.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}
                    {selected.scheduledWindow ? ` · ${selected.scheduledWindow}` : ''}
                  </p>
                )}
                <p className="text-sm font-medium">R {Number(selected.totalAmount).toFixed(2)}</p>
              </CardContent>
            </Card>

            {technicians.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active technicians. Approve applications first.
              </p>
            ) : (
              <form action={dispatchBooking} className="space-y-3">
                <input type="hidden" name="bookingId" value={selected.id} />

                <div className="space-y-2">
                  {technicians.map((tech) => (
                    <label
                      key={tech.id}
                      className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent has-[:checked]:border-foreground has-[:checked]:bg-accent transition-colors"
                    >
                      <input type="radio" name="technicianId" value={tech.id} required />
                      <div>
                        <p className="text-sm font-medium">{tech.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {tech.skills.join(', ') || 'General'} · {tech.serviceAreas.join(', ') || 'All areas'}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>

                <Button type="submit" className="w-full">
                  Assign & notify technician
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
