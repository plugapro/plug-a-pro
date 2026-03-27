// ─── POST /api/customer/bookings ─────────────────────────────────────────────
// Creates a booking, holds the slot, and initiates a payment checkout session.
// Requires auth.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { holdSlot, releaseSlot } from '@/lib/slotting'
import { createCheckout } from '@/lib/payments'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  let body: {
    serviceId: string
    businessId: string
    slotId: string
    street: string
    suburb: string
    city: string
    province: string
    postalCode?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { serviceId, businessId, slotId, street, suburb, city, province, postalCode } = body

  if (!serviceId || !businessId || !slotId || !street || !suburb || !city || !province) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // 1. Resolve or create Customer
  const customer = await db.customer.upsert({
    where: { userId: session.id },
    create: {
      businessId,
      userId: session.id,
      phone: session.phone ?? '',
      name: 'Customer',
      active: true,
    },
    update: {},
  })

  // 2. Create Address
  const address = await db.address.create({
    data: {
      customerId: customer.id,
      street,
      suburb,
      city,
      province,
      postalCode: postalCode ?? null,
    },
  })

  // 3. Get slot details for scheduled date and window
  const slot = await db.slot.findUnique({ where: { id: slotId } })
  if (!slot) {
    return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
  }

  // 4. Hold the slot
  const held = await holdSlot({ slotId, bookingId: 'pending' })
  if (!held) {
    return NextResponse.json({ error: 'Slot is no longer available' }, { status: 409 })
  }

  // 5. Get service for totalAmount
  const service = await db.service.findUnique({ where: { id: serviceId } })
  if (!service) {
    await releaseSlot(slotId)
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  const totalAmount = Number(service.basePrice ?? 0) + Number(service.callOutFee ?? 0)

  // 6. Create Booking
  let booking: { id: string }
  try {
    booking = await db.booking.create({
      data: {
        businessId,
        customerId: customer.id,
        serviceId,
        addressId: address.id,
        slotId,
        status: 'PENDING_PAYMENT',
        totalAmount,
        scheduledDate: slot.date,
        scheduledWindow: `${slot.windowStart}-${slot.windowEnd}`,
      },
      select: { id: true },
    })
  } catch (err) {
    await releaseSlot(slotId)
    console.error('[bookings] booking.create failed', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }

  // 7. Create checkout session
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  let checkoutUrl: string | null = null

  try {
    const checkout = await createCheckout({
      bookingId: booking.id,
      amount: Math.round(totalAmount * 100), // cents
      currency: 'ZAR',
      customerEmail: session.email ?? undefined,
      customerPhone: session.phone ?? undefined,
      description: service.name,
      successUrl: `${appUrl}/bookings/${booking.id}`,
      cancelUrl: `${appUrl}/bookings/${booking.id}`,
      notifyUrl: `${appUrl}/api/webhooks/payments`,
    })
    checkoutUrl = checkout.url

    // 8. Update booking with checkoutUrl
    await db.booking.update({
      where: { id: booking.id },
      data: { /* checkoutUrl stored on Payment via createCheckout */ },
    })
  } catch (err) {
    // Payment setup failed — release the slot but keep the booking for support reference
    await releaseSlot(slotId)
    console.error('[bookings] createCheckout failed', err)
    return NextResponse.json({ error: 'Payment setup failed — please try again' }, { status: 502 })
  }

  // 9. Return bookingId + checkoutUrl
  return NextResponse.json({ bookingId: booking.id, checkoutUrl })
}
