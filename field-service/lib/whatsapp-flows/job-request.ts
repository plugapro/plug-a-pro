// ─── Customer job request flow via WhatsApp ───────────────────────────────────
// Full journey: browse categories → address → availability → confirm → submitted
// Designed for lowest LSM: plain language, clear options, no dead ends

import {
  sendText,
  sendButtons,
  sendList,
  type InboundReply,
} from '../whatsapp-interactive'
import { db } from '../db'
import { getCategoryPolicy, mergeCategoryRequirements } from '../service-category-policy'
import type { FlowContext, FlowResult } from './types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

// Static category list — replaces db.service queries
const JOB_CATEGORIES = [
  { id: 'cat_plumbing',    label: 'Plumbing' },
  { id: 'cat_painting',    label: 'Painting' },
  { id: 'cat_garden',      label: 'Garden & Landscaping' },
  { id: 'cat_handyman',    label: 'Handyman' },
  { id: 'cat_appliances',  label: 'Appliances' },
  { id: 'cat_electrical',  label: 'Electrical' },
  { id: 'cat_diy',         label: 'DIY & Assembly' },
  { id: 'cat_roofing',     label: 'Roofing' },
]

// ─── Flow entry point ─────────────────────────────────────────────────────────

export async function handleJobRequestFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'welcome':
      return handleWelcome(ctx)
    case 'browse_categories':
      return handleBrowseCategories(ctx)
    case 'collect_name':
      return handleCollectNameStep(ctx)
    case 'collect_address':
      return handleCollectAddress(ctx)
    case 'collect_address_street':
      return handleCollectStreet(ctx)
    case 'collect_address_suburb':
      return handleCollectSuburb(ctx)
    case 'confirm_address':
      return handleConfirmAddress(ctx)
    case 'collect_availability':
      return handleCollectAvailability(ctx)
    case 'confirm_job_request':
      return handleConfirmJobRequest(ctx)
    case 'job_request_submitted':
      return handleJobRequestSubmitted(ctx)
    case 'notify_me':
      return handleNotifyMe(ctx)
    default:
      await showMainMenu(ctx.phone)
      return { nextStep: 'welcome' }
  }
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function handleWelcome(ctx: FlowContext): Promise<FlowResult> {
  await showMainMenu(ctx.phone)
  return { nextStep: 'welcome' }
}

async function handleBrowseCategories(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'book' || ctx.step === 'browse_categories') {
    const rows = JOB_CATEGORIES.map((c) => ({
      id: c.id,
      title: c.label,
    }))

    await sendList(
      ctx.phone,
      'What type of service do you need? 👇',
      [{ title: 'Our Services', rows }],
      { buttonLabel: 'Choose Service' }
    )
    return { nextStep: 'collect_name' }
  }

  return { nextStep: 'browse_categories' }
}

// ─── Name capture (first-time customers only) ─────────────────────────────────

async function handleCollectNameStep(ctx: FlowContext): Promise<FlowResult> {
  // If they just selected a category, save it and decide whether to ask for name
  if (ctx.reply.id?.startsWith('cat_')) {
    const categoryEntry = JOB_CATEGORIES.find((c) => c.id === ctx.reply.id)
    const category = categoryEntry?.label ?? ctx.reply.title ?? ''

    // Check if this customer already has a name on record
    const existingCustomer = await db.customer.findUnique({
      where: { phone: ctx.phone },
      select: { name: true, id: true },
    })
    const isFirstBooking = !existingCustomer || existingCustomer.name === 'WhatsApp Customer'

    if (!isFirstBooking) {
      // Returning customer — offer last-used address to save re-entry
      const lastAddress = await db.address.findFirst({
        where: { customerId: existingCustomer!.id },
        orderBy: { createdAt: 'desc' },
      })

      const baseData = { selectedCategory: category, category, customerName: existingCustomer?.name, isFirstBooking: false }

      if (lastAddress) {
        const display = [lastAddress.street, lastAddress.suburb, lastAddress.city].filter(Boolean).join(', ')
        await sendButtons(
          ctx.phone,
          `📍 *Where should we send the worker for ${category}?*\n\nLast used:\n_${display}_`,
          [
            { id: 'addr_same', title: '📍 Same address' },
            { id: 'addr_new',  title: '✏️ Different address' },
          ]
        )
        return {
          nextStep: 'collect_address',
          nextData: {
            ...baseData,
            addressStreet: lastAddress.street,
            addressSuburb: lastAddress.suburb,
            addressCity: lastAddress.city,
            address: display,
            hasSavedAddress: true,
          },
        }
      }

      // No saved address — go straight to street prompt
      await sendText(ctx.phone, `📍 *Where should we send the worker for ${category}?*\n\n*Street:* Type your street address:\n\n_Example: 14 Main Street, Flat 3_`)
      return { nextStep: 'collect_address_street', nextData: baseData }
    }

    await sendText(ctx.phone, '👤 What is your *first name*?\n\n_(Just your first name is fine — e.g. "Zanele")_')
    return {
      nextStep: 'collect_name',
      nextData: { selectedCategory: category, category, isFirstBooking: true },
    }
  }

  // They sent their name as text
  const text = ctx.reply.text?.trim()
  if (!text || text.length < 2) {
    await sendText(ctx.phone, '👤 What is your *first name*?\n\n_(Just your first name is fine — e.g. "Zanele")_')
    return { nextStep: 'collect_name' }
  }

  // Name captured — update customer record
  await db.customer.updateMany({
    where: { phone: ctx.phone, name: 'WhatsApp Customer' },
    data: { name: text },
  })

  await sendText(ctx.phone, `Nice to meet you, *${text}*! 👋\n\n*Street:* Type your street address:\n\n_Example: 14 Main Street, Flat 3_`)
  return { nextStep: 'collect_address_street', nextData: { customerName: text } }
}

// ─── Address collection ───────────────────────────────────────────────────────

async function handleCollectAddress(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'addr_same') {
    // Reuse last address — jump straight to availability
    return handleCollectAvailability(ctx)
  }

  // addr_new or any other reply — start structured address entry
  const category = ctx.data.selectedCategory ?? ctx.data.category ?? 'your service'
  await sendText(
    ctx.phone,
    `📍 *Where should we send the worker for ${category}?*\n\n*Street:* Type your street address:\n\n_Example: 14 Main Street, Flat 3_`
  )
  return { nextStep: 'collect_address_street' }
}

async function handleCollectStreet(ctx: FlowContext): Promise<FlowResult> {
  const street = ctx.reply.text?.trim()
  if (!street || street.length < 3) {
    await sendText(ctx.phone, '❗ Please type your *street address*.\n\n_Example: 14 Main Street, Flat 3_')
    return { nextStep: 'collect_address_street' }
  }

  await sendText(ctx.phone, `✅ *${street}*\n\n*Suburb:* Now type your suburb:\n\n_Example: Sandton_`)
  return { nextStep: 'collect_address_suburb', nextData: { addressStreet: street } }
}

async function handleCollectSuburb(ctx: FlowContext): Promise<FlowResult> {
  const suburb = ctx.reply.text?.trim()
  if (!suburb || suburb.length < 2) {
    await sendText(ctx.phone, '❗ Please type your *suburb*.\n\n_Example: Sandton_')
    return { nextStep: 'collect_address_suburb' }
  }

  await sendText(ctx.phone, `✅ *${suburb}*\n\n*City:* Now type your city:\n\n_Example: Johannesburg_`)
  return { nextStep: 'confirm_address', nextData: { addressSuburb: suburb } }
}

async function handleConfirmAddress(ctx: FlowContext): Promise<FlowResult> {
  const city = ctx.reply.text?.trim()
  if (!city || city.length < 2) {
    await sendText(ctx.phone, '❗ Please type your *city*.\n\n_Example: Johannesburg_')
    return { nextStep: 'confirm_address' }
  }

  const street = ctx.data.addressStreet ?? ''
  const suburb = ctx.data.addressSuburb ?? ''
  const address = [street, suburb, city].filter(Boolean).join(', ')

  await sendButtons(
    ctx.phone,
    `📍 Your address:\n\n*${address}*\n\nIs this correct?`,
    [
      { id: 'addr_yes', title: '✅ Yes, correct' },
      { id: 'addr_no', title: '✏️ Re-enter' },
    ]
  )
  return { nextStep: 'collect_availability', nextData: { addressCity: city, address } }
}

// ─── Availability ─────────────────────────────────────────────────────────────

async function handleCollectAvailability(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'addr_no') {
    const category = ctx.data.selectedCategory ?? ctx.data.category ?? 'your service'
    await sendText(
      ctx.phone,
      `📍 *Where should we send the worker for ${category}?*\n\n*Street:* Type your street address:\n\n_Example: 14 Main Street, Flat 3_`
    )
    return { nextStep: 'collect_address_street' }
  }

  // addr_yes — ask for availability preference
  await sendList(
    ctx.phone,
    '🗓 When are you available for the worker to visit?',
    [{
      title: 'Availability',
      rows: [
        { id: 'avail_asap', title: 'As soon as possible', description: 'First available slot' },
        { id: 'avail_this_week', title: 'This week', description: 'Mon–Fri' },
        { id: 'avail_weekend', title: 'This weekend', description: 'Sat or Sun' },
        { id: 'avail_next_week', title: 'Next week', description: 'Flexible' },
        { id: 'avail_morning', title: 'Mornings only', description: '7am–12pm' },
        { id: 'avail_afternoon', title: 'Afternoons only', description: '12pm–5pm' },
      ],
    }],
    { buttonLabel: 'Choose Availability' }
  )
  return { nextStep: 'confirm_job_request' }
}

// ─── Confirm & submit ─────────────────────────────────────────────────────────

async function handleConfirmJobRequest(ctx: FlowContext): Promise<FlowResult> {
  const availLabels: Record<string, string> = {
    avail_asap:       'As soon as possible',
    avail_this_week:  'This week',
    avail_weekend:    'This weekend',
    avail_next_week:  'Next week',
    avail_morning:    'Mornings only',
    avail_afternoon:  'Afternoons only',
  }

  let availabilityNote = ctx.data.availabilityNote

  if (ctx.reply.id?.startsWith('avail_')) {
    availabilityNote = availLabels[ctx.reply.id] ?? ctx.reply.title ?? ''
  } else if (!availabilityNote) {
    // Not yet selected — re-prompt
    return handleCollectAvailability(ctx)
  }

  const { selectedCategory, address } = ctx.data

  await sendButtons(
    ctx.phone,
    `✅ *Job Request Summary*\n\n🔧 ${selectedCategory}\n📍 ${address}\n🗓 ${availabilityNote}\n\nShall I submit this request? We'll share it with nearby providers whose profiles match this type of work.`,
    [
      { id: 'confirm_yes', title: '✅ Submit Request' },
      { id: 'confirm_no', title: '❌ Cancel' },
    ]
  )
  return { nextStep: 'job_request_submitted', nextData: { availabilityNote } }
}

async function handleJobRequestSubmitted(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'confirm_no') {
    await sendText(
      ctx.phone,
      "No problem! Your request has been discarded. Send 'Hi' anytime to start a new request. 👋"
    )
    return { nextStep: 'cancelled' }
  }

  if (ctx.reply.id !== 'confirm_yes') {
    return { nextStep: 'job_request_submitted' }
  }

  try {
    const category = ctx.data.category ?? ctx.data.selectedCategory ?? ''
    const categoryRequirements = mergeCategoryRequirements({ category })
    const categoryPolicy = getCategoryPolicy(category)

    // Find or create customer
    const customer = await db.customer.upsert({
      where: { phone: ctx.phone },
      create: {
        phone: ctx.phone,
        name: ctx.data.customerName ?? 'WhatsApp Customer',
      },
      update: {},
    })

    // Find or create address — prefer structured fields, fall back to split for legacy data
    const addrParts = (ctx.data.address ?? '').split(',').map((p) => p.trim())
    const address = await db.address.create({
      data: {
        customerId: customer.id,
        street: ctx.data.addressStreet ?? addrParts[0] ?? '',
        suburb: ctx.data.addressSuburb ?? addrParts[1] ?? '',
        city:   ctx.data.addressCity   ?? addrParts[2] ?? addrParts[1] ?? '',
        province: addrParts[3] ?? '',
      },
    })

    // Create JobRequest
    const jobRequest = await db.jobRequest.create({
      data: {
        customerId: customer.id,
        addressId: address.id,
        category,
        title: ctx.data.selectedCategory ?? '',
        description: ctx.data.availabilityNote
          ? `Preferred availability: ${ctx.data.availabilityNote}`
          : '',
        estimatedDurationMinutes: 120,
        requiredCertificationCodes: categoryRequirements.requiredCertificationCodes,
        requiredEquipmentTags: categoryRequirements.requiredEquipmentTags,
        requiredVehicleTypes: categoryRequirements.requiredVehicleTypes,
        autoCreateBookingOnAssignment: false,
        assignmentMode: 'AUTO_ASSIGN',
        status: 'OPEN',
      },
    })

    // Trigger matching in background — non-blocking
    import('../matching-engine')
      .then(({ dispatchLeads }) => dispatchLeads(jobRequest.id))
      .then((result) => {
        if (result.noMatch) {
          console.log(`[job-request] No providers found for ${jobRequest.id} — cron will retry`)
        }
      })
      .catch((err) => console.error('[job-request] Matching error:', err))

    await sendButtons(
      ctx.phone,
      `🎉 *Request submitted!*\n\n🔧 ${ctx.data.selectedCategory}\nRef: *${jobRequest.id.slice(-8).toUpperCase()}*\n\nWe're finding you a nearby worker — you'll get a WhatsApp update when matched.${categoryPolicy.bookingOnAssignment ? '\n\n_If your price is already agreed for this type of work, the booking can be confirmed as soon as a provider accepts._' : ''}`,
      [
        { id: 'status', title: '📋 Track My Request' },
        { id: 'back_home', title: '🏠 Main Menu' },
      ]
    )

    return { nextStep: 'done', nextData: { jobRequestId: jobRequest.id, customerId: customer.id } }
  } catch (err) {
    console.error('[job-request-flow] Create job request error:', err)
    await sendText(
      ctx.phone,
      "😔 Something went wrong submitting your request. Please try again or contact us directly."
    )
    return { nextStep: 'done' }
  }
}

// ─── Notify Me (no providers in area) ─────────────────────────────────────────

async function handleNotifyMe(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    await showMainMenu(ctx.phone)
    return { nextStep: 'welcome' }
  }

  if (ctx.reply.id === 'notify_me' || ctx.step === 'notify_me') {
    const customer = await db.customer.upsert({
      where: { phone: ctx.phone },
      create: {
        phone: ctx.phone,
        name: ctx.data.customerName ?? 'WhatsApp Customer',
      },
      update: {},
    })

    await sendText(
      ctx.phone,
      `✅ Got it! We'll notify you as soon as a worker is available for *${ctx.data.selectedCategory ?? 'your service'}* in your area.\n\nYou'll receive a WhatsApp message when we have a match. 🔔`
    )

    return { nextStep: 'done', nextData: { customerId: customer.id } }
  }

  return { nextStep: 'notify_me' }
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

export async function showMainMenu(phone: string): Promise<void> {
  await sendList(
    phone,
    '👋 Welcome to Plug a Pro!\n\nHow can I help you today?',
    [
      {
        title: 'Services',
        rows: [
          { id: 'book',      title: '🔧 Request a Service', description: 'Book a plumber, electrician, cleaner & more' },
          { id: 'status',    title: '📋 My Request',        description: 'Track or manage an existing booking' },
          { id: 'help',      title: '❓ Get Help',          description: 'FAQs, pricing, support' },
        ],
      },
      {
        title: 'For Service Providers',
        rows: [
          { id: 'find_work', title: '👷 Find Work',         description: 'Apply to join as a service provider' },
        ],
      },
    ],
    { buttonLabel: 'Choose Option' }
  )
}
