// ─── Customer booking flow via WhatsApp ──────────────────────────────────────
// Full journey: browse → service → address → slot → confirm → pay
// Designed for lowest LSM: plain language, clear options, no dead ends

import {
  sendText,
  sendButtons,
  sendList,
  sendCtaUrl,
  type InboundReply,
} from '../whatsapp-interactive'
import { db } from '../db'
import { getAvailableSlots } from '../slotting'
import { createCheckout } from '../payments'
import type { FlowContext, FlowResult } from './types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

// ─── Flow entry point ─────────────────────────────────────────────────────────

export async function handleBookingFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'welcome':
      return handleWelcome(ctx)
    case 'browse_categories':
      return handleBrowseCategories(ctx)
    case 'browse_services':
      return handleBrowseServices(ctx)
    case 'collect_name':
      return handleCollectNameStep(ctx)
    case 'collect_address':
      return handleCollectAddress(ctx)
    case 'confirm_address':
      return handleConfirmAddress(ctx)
    case 'select_slot':
      return handleSelectSlot(ctx)
    case 'notify_me':
      return handleNotifyMe(ctx)
    case 'confirm_booking':
      return handleConfirmBooking(ctx)
    case 'await_payment':
      return handleAwaitPayment(ctx)
    default:
      await showMainMenu(ctx.phone)
      return { nextStep: 'welcome' }
  }
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function handleWelcome(ctx: FlowContext): Promise<FlowResult> {
  await sendButtons(
    ctx.phone,
    '👋 Welcome to Plug a Pro!\n\nI can help you book a service, check your booking, or answer questions.',
    [
      { id: 'book', title: '🔧 Book a Service' },
      { id: 'status', title: '📋 My Booking' },
      { id: 'help', title: '❓ Get Help' },
    ]
  )
  return { nextStep: 'welcome' }
}

async function handleBrowseCategories(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'book' || ctx.step === 'browse_categories') {
    const services = await db.service.findMany({
      where: { businessId: ctx.businessId, active: true },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    })

    if (services.length === 0) {
      await sendText(ctx.phone, 'Sorry, no services are available right now. Please try again later.')
      return { nextStep: 'done' }
    }

    const rows = services.map((s) => ({
      id: `cat_${s.category.toLowerCase().replace(/\s+/g, '_')}`,
      title: s.category,
    }))

    await sendList(
      ctx.phone,
      'What type of service do you need? 👇',
      [{ title: 'Our Services', rows }],
      { buttonLabel: 'Choose Service' }
    )
    return { nextStep: 'browse_services' }
  }

  return { nextStep: 'browse_categories' }
}

async function handleBrowseServices(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('cat_') && !ctx.reply.id?.startsWith('svc_')) {
    await sendText(ctx.phone, 'Please choose a service category from the list above.')
    return { nextStep: 'browse_services', nextData: ctx.data }
  }

  if (ctx.reply.id?.startsWith('cat_')) {
    // They selected a category — show services in that category
    const categorySlug = ctx.reply.id.replace('cat_', '')
    const category = ctx.reply.title ?? ''

    const services = await db.service.findMany({
      where: {
        businessId: ctx.businessId,
        active: true,
        category: { equals: category, mode: 'insensitive' },
      },
      orderBy: { sortOrder: 'asc' },
    })

    if (services.length === 0) {
      await sendText(ctx.phone, `No services available in ${category} right now.`)
      return { nextStep: 'browse_categories' }
    }

    const rows = services.map((s) => ({
      id: `svc_${s.id}`,
      title: s.name.slice(0, 24),
      description: s.basePrice
        ? `From R ${Number(s.basePrice).toFixed(0)} · ~${s.duration} min`
        : `Quote required · ~${s.duration} min`,
    }))

    await sendList(
      ctx.phone,
      `*${category}* services — tap one to book:`,
      [{ rows }],
      { buttonLabel: 'Select Service' }
    )
    return { nextStep: 'browse_services' }
  }

  if (ctx.reply.id?.startsWith('svc_')) {
    // They selected a service
    const serviceId = ctx.reply.id.replace('svc_', '')
    const service = await db.service.findUnique({ where: { id: serviceId } })

    if (!service) {
      await sendText(ctx.phone, 'Service not found. Please choose again.')
      return { nextStep: 'browse_categories' }
    }

    const priceNote = service.basePrice
      ? `💰 From *R ${Number(service.basePrice).toFixed(0)}*`
      : '💬 Price will be quoted after we assess the job'

    await sendButtons(
      ctx.phone,
      `*${service.name}*\n\n${service.description ?? ''}\n\n${priceNote}\n⏱ Approximately ${service.duration} minutes`,
      [
        { id: 'book_this', title: '✅ Book This' },
        { id: 'back', title: '← Back' },
      ]
    )
    // Check if this customer already has a real name on record
    const existingCustomer = await db.customer.findUnique({
      where: { businessId_phone: { businessId: ctx.businessId, phone: ctx.phone } },
      select: { name: true },
    })
    const isFirstBooking = !existingCustomer || existingCustomer.name === 'WhatsApp Customer'

    return {
      nextStep: isFirstBooking ? 'collect_name' : 'collect_address',
      nextData: {
        selectedServiceId: service.id,
        selectedServiceName: service.name,
        selectedServicePrice: service.basePrice ? Number(service.basePrice) : undefined,
        customerName: existingCustomer?.name !== 'WhatsApp Customer' ? existingCustomer?.name : undefined,
        isFirstBooking,
      },
    }
  }

  return { nextStep: 'browse_services' }
}

// ─── Name capture (first-time customers only) ─────────────────────────────────
// Called after service selection when customer has no name on record.

async function handleCollectNameStep(ctx: FlowContext): Promise<FlowResult> {
  const text = ctx.reply.text?.trim()

  if (!text || text.length < 2) {
    await sendText(
      ctx.phone,
      '👤 What is your *first name*?\n\n_(Just your first name is fine — e.g. "Zanele")_'
    )
    return { nextStep: 'collect_name' }
  }

  // Name captured — update customer record
  await db.customer.updateMany({
    where: {
      phone: ctx.phone,
      businessId: ctx.businessId,
      name: 'WhatsApp Customer',  // only overwrite the placeholder
    },
    data: { name: text },
  })

  await sendText(
    ctx.phone,
    `Nice to meet you, *${text}*! 👋\n\nNow, where should we send the technician?`
  )
  return { nextStep: 'confirm_address', nextData: { customerName: text } }
}

// ─── Slot waitlist ─────────────────────────────────────────────────────────────
// Customer tapped "Notify Me" when no slots were available.

async function handleNotifyMe(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    await showMainMenu(ctx.phone)
    return { nextStep: 'welcome' }
  }

  if (ctx.reply.id === 'notify_me' || ctx.step === 'notify_me') {
    // Upsert customer so we have a record to notify later
    const customer = await db.customer.upsert({
      where: { businessId_phone: { businessId: ctx.businessId, phone: ctx.phone } },
      create: {
        businessId: ctx.businessId,
        phone: ctx.phone,
        name: ctx.data.customerName ?? 'WhatsApp Customer',
      },
      update: {},
    })

    // Store waitlist preference in conversation data for admin visibility
    await sendText(
      ctx.phone,
      `✅ Got it! We'll notify you as soon as a slot opens for *${ctx.data.selectedServiceName ?? 'your service'}* in your area.\n\nYou'll receive a WhatsApp message with a direct booking link. 🔔`
    )

    return { nextStep: 'done', nextData: { customerId: customer.id } }
  }

  return { nextStep: 'notify_me' }
}

async function handleCollectAddress(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back') {
    return handleBrowseCategories(ctx)
  }

  if (ctx.reply.id === 'book_this' || ctx.step === 'collect_address') {
    await sendText(
      ctx.phone,
      '📍 Please type your *full address*:\n\nExample:\n_14 Main Street, Soweto, Johannesburg_\n\nInclude your street, suburb, and city.'
    )
    return { nextStep: 'confirm_address' }
  }

  return { nextStep: 'collect_address' }
}

async function handleConfirmAddress(ctx: FlowContext): Promise<FlowResult> {
  const address = ctx.reply.text

  if (!address || address.length < 10) {
    await sendText(
      ctx.phone,
      '❗ Please type your full address including street, suburb, and city.'
    )
    return { nextStep: 'confirm_address' }
  }

  await sendButtons(
    ctx.phone,
    `📍 Your address:\n\n*${address}*\n\nIs this correct?`,
    [
      { id: 'addr_yes', title: '✅ Yes, correct' },
      { id: 'addr_no', title: '✏️ Re-enter' },
    ]
  )
  return { nextStep: 'select_slot', nextData: { address } }
}

async function handleSelectSlot(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'addr_no') {
    return handleCollectAddress({ ...ctx, reply: { type: 'button_reply', id: 'book_this' } })
  }

  if (ctx.reply.id?.startsWith('slot_')) {
    // Slot selected — go to confirmation
    const slotId = ctx.reply.id.replace('slot_', '')
    return {
      nextStep: 'confirm_booking',
      nextData: {
        selectedSlotId: slotId,
        selectedSlotLabel: ctx.reply.title ?? '',
      },
    }
  }

  // addr_yes or entering this step — show slots
  const serviceId = ctx.data.selectedServiceId
  const address = ctx.data.address ?? ''

  // Parse suburb/city from free-text address (best effort)
  const parts = address.split(',').map((p) => p.trim())
  const suburb = parts[1] ?? parts[0] ?? ''
  const city = parts[2] ?? parts[1] ?? ''

  const slots = await getAvailableSlots({
    businessId: ctx.businessId,
    serviceId: serviceId!,
    suburb,
    city,
    limit: 6,
  })

  if (slots.length === 0) {
    await sendButtons(
      ctx.phone,
      `😔 Sorry, no slots are available for your area right now.\n\nWould you like us to contact you when a slot opens?`,
      [
        { id: 'notify_me', title: '🔔 Notify Me' },
        { id: 'back_home', title: '← Main Menu' },
      ]
    )
    return { nextStep: 'notify_me' }
  }

  const rows = slots.map((s) => ({
    id: `slot_${s.id ?? s.windowStart}`,
    title: `${new Date(s.date).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}`,
    description: `${s.windowStart}–${s.windowEnd}`,
  }))

  await sendList(
    ctx.phone,
    '🗓 Choose a time that works for you:',
    [{ title: 'Available Slots', rows }],
    { buttonLabel: 'Choose Time' }
  )
  return { nextStep: 'confirm_booking' }
}

async function handleConfirmBooking(ctx: FlowContext): Promise<FlowResult> {
  if (!ctx.reply.id?.startsWith('slot_') && ctx.step === 'confirm_booking') {
    // They haven't selected a slot yet
    return handleSelectSlot(ctx)
  }

  const { selectedServiceName, selectedServicePrice, address, selectedSlotLabel } = ctx.data
  const priceNote = selectedServicePrice
    ? `💰 *R ${selectedServicePrice.toFixed(0)}*`
    : '💬 Price will be confirmed by admin'

  await sendButtons(
    ctx.phone,
    `✅ *Booking Summary*\n\n🔧 ${selectedServiceName}\n📍 ${address}\n🗓 ${selectedSlotLabel}\n${priceNote}\n\nShall I confirm this booking?`,
    [
      { id: 'confirm_yes', title: '✅ Confirm' },
      { id: 'confirm_no', title: '❌ Cancel' },
    ]
  )
  return { nextStep: 'await_payment' }
}

async function handleAwaitPayment(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'confirm_no') {
    await sendText(
      ctx.phone,
      "No problem! Your booking has been cancelled. Send 'Hi' anytime to start a new booking. 👋"
    )
    return { nextStep: 'cancelled' }
  }

  if (ctx.reply.id !== 'confirm_yes') {
    return { nextStep: 'await_payment' }
  }

  try {
    // Find or create customer
    const customer = await db.customer.upsert({
      where: { businessId_phone: { businessId: ctx.businessId, phone: ctx.phone } },
      create: {
        businessId: ctx.businessId,
        phone: ctx.phone,
        name: 'WhatsApp Customer',
      },
      update: {},
    })

    // Find or create address
    const addrParts = (ctx.data.address ?? '').split(',').map((p) => p.trim())
    const address = await db.address.create({
      data: {
        customerId: customer.id,
        street: addrParts[0] ?? ctx.data.address ?? '',
        suburb: addrParts[1] ?? '',
        city: addrParts[2] ?? addrParts[1] ?? '',
        province: addrParts[3] ?? '',
      },
    })

    // Create booking
    const slot = ctx.data.selectedSlotId
      ? await db.slot.findUnique({ where: { id: ctx.data.selectedSlotId } })
      : null

    const booking = await db.booking.create({
      data: {
        businessId: ctx.businessId,
        customerId: customer.id,
        serviceId: ctx.data.selectedServiceId!,
        addressId: address.id,
        slotId: slot?.id,
        status: 'PENDING_PAYMENT',
        totalAmount: ctx.data.selectedServicePrice ?? 0,
        scheduledDate: slot?.date,
        scheduledWindow: slot ? `${slot.windowStart}–${slot.windowEnd}` : undefined,
      },
    })

    if (ctx.data.selectedServicePrice && ctx.data.selectedServicePrice > 0) {
      // Create payment checkout
      const successUrl = `${APP_URL}/bookings/${booking.id}?payment=success`
      const cancelUrl = `${APP_URL}/bookings/${booking.id}?payment=cancelled`
      const notifyUrl = `${APP_URL}/api/webhooks/payments`

      const checkout = await createCheckout({
        bookingId: booking.id,
        amount: Math.round(ctx.data.selectedServicePrice * 100),
        currency: 'ZAR',
        customerPhone: ctx.phone,
        description: ctx.data.selectedServiceName ?? 'Service booking',
        successUrl,
        cancelUrl,
        notifyUrl,
      })

      await sendCtaUrl(
        ctx.phone,
        `🎉 Almost done! Your booking is reserved.\n\n*Complete your payment* to confirm:`,
        'Pay Now',
        checkout.url,
        { footer: 'Secure payment · Booking held for 30 minutes' }
      )
    } else {
      // Quote-required service — no payment now
      await sendText(
        ctx.phone,
        `✅ Booking request received!\n\nWe'll review your request and send you a quote shortly.\n\nBooking ref: *${booking.id.slice(-8).toUpperCase()}*`
      )
    }

    return { nextStep: 'done', nextData: { bookingId: booking.id, customerId: customer.id } }
  } catch (err) {
    console.error('[booking-flow] Create booking error:', err)
    await sendText(
      ctx.phone,
      "😔 Something went wrong creating your booking. Please try again or contact us directly."
    )
    return { nextStep: 'done' }
  }
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

export async function showMainMenu(phone: string): Promise<void> {
  await sendButtons(
    phone,
    '👋 Welcome to Plug a Pro!\n\nHow can I help you today?',
    [
      { id: 'book', title: '🔧 Book a Service' },
      { id: 'status', title: '📋 My Booking' },
      { id: 'help', title: '❓ Get Help' },
    ]
  )
}
