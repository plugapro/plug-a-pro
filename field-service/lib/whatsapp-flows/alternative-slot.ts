// ─── Alternative-slot negotiation flow ────────────────────────────────────────
// Handles the WA conversation after orchestrateMatch returns NO_MATCH with near-miss
// providers. Two strategies:
//
//   customer_first (multiple near-miss providers OR any ≥ 2):
//     1. Customer is sent a list of up to 3 alternative time slots to choose from.
//     2. On pick → update job window → re-run orchestrateMatch.
//     3. On decline → mark outcome and send a sorry message.
//
//   provider_first (scarcity: exactly 1 near-miss provider):
//     1. Provider is sent up to 3 slot options (sendButtons).
//     2. On pick → ask customer to confirm the slot (sendButtons).
//     3. Customer ok → update job window + preferredProviderId → re-run orchestrateMatch.
//     4. Customer no OR provider decline → fall through / mark outcome.
//
// Button ID scheme (all stateless — IDs carry the data):
//   Customer picks slot:       alt_slot_c:{slotKey}:{jobRequestId}
//   Customer declines all:     alt_slot_c:none:{jobRequestId}
//   Provider picks slot:       alt_slot_p:{slotKey}:{jobRequestId}
//   Provider declines all:     alt_slot_p:none:{jobRequestId}
//   Customer confirms prov's:  alt_cust_ok:{slotKey}:{providerId}:{jobRequestId}
//   Customer rejects prov's:   alt_cust_no:{jobRequestId}

import { db } from '../db'
import { sendText, sendButtons, sendList } from '../whatsapp-interactive'
import type { SlotOption } from '../matching/types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

// ── Public entry point — called by orchestrator on NO_MATCH ──────────────────

export async function initiateAlternativeSlotNegotiation(params: {
  jobRequestId: string
  customerPhone: string
  customerName: string
  category: string
  slotOptions: SlotOption[]
  dispatchDecisionId: string
  strategy: 'customer_first' | 'provider_first'
  // provider_first only
  providerPhone?: string
  providerName?: string
}): Promise<void> {
  const {
    jobRequestId,
    customerPhone,
    customerName,
    category,
    slotOptions,
    strategy,
    providerPhone,
    providerName,
  } = params

  // Mark the job request as having sent negotiation
  await db.jobRequest.update({
    where: { id: jobRequestId },
    data: { altSlotNegotiationSentAt: new Date() },
  })

  const firstName = (customerName || 'there').split(/\s+/)[0]
  const categoryDisplay = category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, ' ')

  if (strategy === 'provider_first' && providerPhone && providerName && slotOptions.length > 0) {
    await sendProviderSlotOffer({
      jobRequestId,
      providerPhone,
      providerName,
      categoryDisplay,
      slotOptions,
    })

    // Let customer know we're working on it
    await sendText(
      customerPhone,
      `🕐 *Still searching for your ${categoryDisplay} pro!*\n\nHi *${firstName}*, we found a nearby provider and are checking their availability. We'll confirm shortly.\n\nReply *Hi* anytime to check your request status.`
    ).catch(() => {})
  } else {
    // customer_first — offer slots directly to customer
    await sendCustomerSlotOffer({
      jobRequestId,
      customerPhone,
      customerName: firstName,
      categoryDisplay,
      slotOptions,
    })
  }
}

// ── Provider receives slot options ────────────────────────────────────────────

async function sendProviderSlotOffer(params: {
  jobRequestId: string
  providerPhone: string
  providerName: string
  categoryDisplay: string
  slotOptions: SlotOption[]
}): Promise<void> {
  const { jobRequestId, providerPhone, providerName, categoryDisplay, slotOptions } = params
  const provFirstName = providerName.split(/\s+/)[0]

  // Max 3 buttons — use first 2 slots + decline (sendButtons cap = 3)
  const slotButtons = slotOptions.slice(0, 2).map((s, i) => ({
    id: `alt_slot_p:${s.slotKey}:${jobRequestId}`,
    title: s.slotLabel.slice(0, 20),  // WA button title max 20 chars
  }))

  const buttons = [
    ...slotButtons,
    { id: `alt_slot_p:none:${jobRequestId}`, title: '❌ Not available' },
  ]

  await sendButtons(
    providerPhone,
    `👷 *New Job Opportunity*\n\nHi *${provFirstName}*! A customer needs *${categoryDisplay}* services but their preferred time doesn't fit your schedule.\n\nCan you take this job on one of these alternative slots?`,
    buttons
  )
}

// ── Customer receives slot options ────────────────────────────────────────────

async function sendCustomerSlotOffer(params: {
  jobRequestId: string
  customerPhone: string
  customerName: string
  categoryDisplay: string
  slotOptions: SlotOption[]
}): Promise<void> {
  const { jobRequestId, customerPhone, customerName, categoryDisplay, slotOptions } = params

  if (slotOptions.length === 0) {
    // No alternatives found — send a sorry message
    await sendText(
      customerPhone,
      `😔 *No providers available*\n\nHi *${customerName}*, we searched but couldn't find a ${categoryDisplay} provider for your requested time or any nearby alternatives.\n\nWe'll keep trying to match you. You'll receive a notification as soon as a provider becomes available.\n\nReply *Hi* to check status or *Cancel* to withdraw your request.`
    )
    return
  }

  // Use sendList (supports 4 rows — 3 slots + "None of these work")
  const rows = slotOptions.map((s) => ({
    id: `alt_slot_c:${s.slotKey}:${jobRequestId}`,
    title: s.slotLabel.slice(0, 24),
    description: `${s.providers.length} provider${s.providers.length === 1 ? '' : 's'} available`,
  }))

  rows.push({
    id: `alt_slot_c:none:${jobRequestId}`,
    title: 'None of these work',
    description: "Keep searching for my preferred time",
  })

  await sendList(
    customerPhone,
    `📅 *Alternative times for ${categoryDisplay}*\n\nHi *${customerName}*, no providers were available for your requested window.\n\nGood news — here are times when nearby providers ARE available:`,
    [{ title: 'Pick a time slot', rows }],
    {
      header: '🔄 Alternative Slots',
      footer: 'Selecting a slot books you in immediately.',
      buttonLabel: 'See available times',
    }
  )
}

// ── Customer selects / declines a slot ────────────────────────────────────────

/**
 * Called by whatsapp-bot when customer taps alt_slot_c:{slotKey}:{jobRequestId}
 * or alt_slot_c:none:{jobRequestId}
 */
export async function handleCustomerSlotResponse(
  phone: string,
  buttonId: string
): Promise<void> {
  // Parse: alt_slot_c:{slotKey}:{jobRequestId}
  // slotKey format: "2026-04-29:morning" — contains a colon, so we split from the end
  const withoutPrefix = buttonId.slice('alt_slot_c:'.length)

  if (withoutPrefix.startsWith('none:')) {
    const jobRequestId = withoutPrefix.slice('none:'.length)
    await handleCustomerDeclinedAllSlots(phone, jobRequestId)
    return
  }

  // slotKey = "{date}:{band}", jobRequestId follows — split on last colon
  const lastColon = withoutPrefix.lastIndexOf(':')
  const jobRequestId = withoutPrefix.slice(lastColon + 1)
  const slotKey = withoutPrefix.slice(0, lastColon)

  await handleCustomerSelectedSlot(phone, jobRequestId, slotKey)
}

async function handleCustomerSelectedSlot(
  phone: string,
  jobRequestId: string,
  slotKey: string
): Promise<void> {
  // Load the slot details from the DispatchDecision
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: {
      id: true,
      status: true,
      category: true,
      customerId: true,
      altSlotNegotiationSentAt: true,
      altSlotNegotiationOutcome: true,
      latestDispatchDecisionId: true,
    },
  })

  if (!jobRequest) {
    await sendText(phone, "❌ Request not found. Reply *Hi* to check your current requests.")
    return
  }
  if (jobRequest.altSlotNegotiationOutcome != null) {
    // Already responded — idempotent
    await sendText(phone, "✅ You've already responded to this slot offer. Reply *Hi* to check your request status.")
    return
  }

  // Load slot from the latest dispatch decision
  const slotOption = await loadSlotOption(jobRequest.latestDispatchDecisionId, slotKey)
  if (!slotOption) {
    await sendText(phone, "❌ That slot option has expired. Reply *Hi* to check your request status.")
    return
  }

  const probeStart = new Date(slotOption.probeStartUtc)
  const probeEnd = new Date(slotOption.probeEndUtc)

  // Update job: new window + clear negotiation lock + mark outcome
  await db.jobRequest.update({
    where: { id: jobRequestId },
    data: {
      requestedWindowStart: probeStart,
      requestedWindowEnd: probeEnd,
      requestedArrivalLatest: null,
      altSlotNegotiationOutcome: 'CUSTOMER_SELECTED',
      status: 'OPEN',   // ensure OPEN so orchestrator can run
    },
  })

  const categoryDisplay = jobRequest.category.charAt(0).toUpperCase() +
    jobRequest.category.slice(1).replace(/-/g, ' ')

  await sendText(
    phone,
    `✅ *Slot confirmed!*\n\nGreat choice! We've updated your *${categoryDisplay}* request to *${slotOption.slotLabel}*.\n\nWe're now matching you with a provider for that time and will notify you as soon as one accepts. 🔧`
  )

  // Fire-and-forget re-match with the new window
  void triggerRematch(jobRequestId)
}

async function handleCustomerDeclinedAllSlots(
  phone: string,
  jobRequestId: string
): Promise<void> {
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: { id: true, altSlotNegotiationOutcome: true, category: true },
  })

  if (!jobRequest || jobRequest.altSlotNegotiationOutcome != null) {
    await sendText(phone, "✅ Your response has been noted. Reply *Hi* for your request status.")
    return
  }

  await db.jobRequest.update({
    where: { id: jobRequestId },
    data: { altSlotNegotiationOutcome: 'CUSTOMER_DECLINED' },
  })

  const categoryDisplay = jobRequest.category.charAt(0).toUpperCase() +
    jobRequest.category.slice(1).replace(/-/g, ' ')

  await sendText(
    phone,
    `📋 *Understood — keeping your original request.*\n\nWe'll continue searching for a *${categoryDisplay}* provider for your preferred time.\n\nYou'll be notified as soon as someone becomes available. Reply *Hi* anytime to check status.`
  )
}

// ── Provider selects / declines a slot ────────────────────────────────────────

/**
 * Called by whatsapp-bot when provider taps alt_slot_p:{slotKey}:{jobRequestId}
 * or alt_slot_p:none:{jobRequestId}
 */
export async function handleProviderSlotResponse(
  phone: string,
  buttonId: string
): Promise<void> {
  const withoutPrefix = buttonId.slice('alt_slot_p:'.length)

  if (withoutPrefix.startsWith('none:')) {
    const jobRequestId = withoutPrefix.slice('none:'.length)
    await handleProviderDeclinedAllSlots(phone, jobRequestId)
    return
  }

  const lastColon = withoutPrefix.lastIndexOf(':')
  const jobRequestId = withoutPrefix.slice(lastColon + 1)
  const slotKey = withoutPrefix.slice(0, lastColon)

  await handleProviderSelectedSlot(phone, jobRequestId, slotKey)
}

async function handleProviderSelectedSlot(
  phone: string,
  jobRequestId: string,
  slotKey: string
): Promise<void> {
  const provider = await db.provider.findUnique({
    where: { phone },
    select: { id: true, name: true },
  })
  if (!provider) {
    await sendText(phone, "❌ Provider account not found.")
    return
  }

  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: {
      id: true,
      status: true,
      category: true,
      altSlotNegotiationOutcome: true,
      latestDispatchDecisionId: true,
      customer: { select: { id: true, phone: true, name: true } },
    },
  })

  if (!jobRequest || jobRequest.altSlotNegotiationOutcome != null) {
    await sendText(phone, "✅ This request has already been resolved. Check the app for updates.")
    return
  }

  const slotOption = await loadSlotOption(jobRequest.latestDispatchDecisionId, slotKey)
  if (!slotOption) {
    await sendText(phone, "❌ That slot option has expired.")
    return
  }

  const customerPhone = jobRequest.customer?.phone
  if (!customerPhone) {
    await sendText(phone, "❌ Customer contact details unavailable — this request has been passed back to our team.")
    return
  }

  const categoryDisplay = jobRequest.category.charAt(0).toUpperCase() +
    jobRequest.category.slice(1).replace(/-/g, ' ')

  // Acknowledge to provider
  await sendText(
    phone,
    `✅ *Slot noted!* We're asking the customer to confirm *${slotOption.slotLabel}*. We'll let you know once they confirm.`
  )

  // Ask customer to confirm
  const customerFirstName = (jobRequest.customer?.name || 'there').split(/\s+/)[0]

  await sendButtons(
    customerPhone,
    `🎉 *Great news!*\n\nHi *${customerFirstName}*, a *${categoryDisplay}* provider is available on *${slotOption.slotLabel}*.\n\nDoes this time work for you?`,
    [
      {
        id: `alt_cust_ok:${slotKey}:${provider.id}:${jobRequestId}`,
        title: '✅ Yes, confirm slot',
      },
      {
        id: `alt_cust_no:${jobRequestId}`,
        title: '❌ No, different time',
      },
    ]
  )
}

async function handleProviderDeclinedAllSlots(
  phone: string,
  jobRequestId: string
): Promise<void> {
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: {
      id: true,
      category: true,
      altSlotNegotiationOutcome: true,
      customer: { select: { phone: true, name: true } },
    },
  })

  if (!jobRequest || jobRequest.altSlotNegotiationOutcome != null) {
    await sendText(phone, "Understood, thanks.")
    return
  }

  await db.jobRequest.update({
    where: { id: jobRequestId },
    data: { altSlotNegotiationOutcome: 'PROVIDER_DECLINED' },
  })

  await sendText(phone, "No problem — we'll look for other providers. Thanks for letting us know. 👍")

  // Notify customer and switch to customer-first for remaining slots
  const customerPhone = jobRequest.customer?.phone
  if (customerPhone) {
    const customerFirstName = (jobRequest.customer?.name || 'there').split(/\s+/)[0]
    const categoryDisplay = jobRequest.category.charAt(0).toUpperCase() +
      jobRequest.category.slice(1).replace(/-/g, ' ')

    await sendText(
      customerPhone,
      `📋 *Still searching…*\n\nHi *${customerFirstName}*, we're still working to find you a *${categoryDisplay}* provider.\n\nWe'll notify you as soon as one becomes available. Reply *Hi* to check status.`
    ).catch(() => {})
  }
}

// ── Customer confirms/rejects provider's chosen slot ─────────────────────────

/**
 * Called by whatsapp-bot when customer taps
 * alt_cust_ok:{slotKey}:{providerId}:{jobRequestId} or alt_cust_no:{jobRequestId}
 */
export async function handleCustomerSlotConfirmation(
  phone: string,
  buttonId: string
): Promise<void> {
  if (buttonId.startsWith('alt_cust_no:')) {
    const jobRequestId = buttonId.slice('alt_cust_no:'.length)
    await handleCustomerRejectedProviderSlot(phone, jobRequestId)
    return
  }

  // alt_cust_ok:{slotKey}:{providerId}:{jobRequestId}
  // slotKey = "2026-04-29:morning" (contains one colon), so we split carefully
  const withoutPrefix = buttonId.slice('alt_cust_ok:'.length)
  // Last segment = jobRequestId, second-to-last = providerId, rest = slotKey
  const parts = withoutPrefix.split(':')
  if (parts.length < 4) {
    await sendText(phone, "❌ Invalid response. Reply *Hi* to check your request.")
    return
  }
  const jobRequestId = parts[parts.length - 1]
  const providerId = parts[parts.length - 2]
  // slotKey = first two segments: "2026-04-29:morning"
  const slotKey = parts.slice(0, parts.length - 2).join(':')

  await handleCustomerConfirmedProviderSlot(phone, jobRequestId, slotKey, providerId)
}

async function handleCustomerConfirmedProviderSlot(
  phone: string,
  jobRequestId: string,
  slotKey: string,
  providerId: string
): Promise<void> {
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: {
      id: true,
      status: true,
      category: true,
      altSlotNegotiationOutcome: true,
      latestDispatchDecisionId: true,
    },
  })

  if (!jobRequest || jobRequest.altSlotNegotiationOutcome != null) {
    await sendText(phone, "✅ Already confirmed — check your request status by replying *Hi*.")
    return
  }

  const slotOption = await loadSlotOption(jobRequest.latestDispatchDecisionId, slotKey)
  if (!slotOption) {
    await sendText(phone, "❌ That slot has expired. Reply *Hi* to see new options.")
    return
  }

  const probeStart = new Date(slotOption.probeStartUtc)
  const probeEnd = new Date(slotOption.probeEndUtc)
  const categoryDisplay = jobRequest.category.charAt(0).toUpperCase() +
    jobRequest.category.slice(1).replace(/-/g, ' ')

  // Update job with new window + preferred provider + outcome
  await db.jobRequest.update({
    where: { id: jobRequestId },
    data: {
      requestedWindowStart: probeStart,
      requestedWindowEnd: probeEnd,
      requestedArrivalLatest: null,
      preferredProviderId: providerId,
      altSlotNegotiationOutcome: 'CUSTOMER_SELECTED',
      status: 'OPEN',
    },
  })

  await sendText(
    phone,
    `✅ *Booking confirmed!*\n\nYour *${categoryDisplay}* request has been updated to *${slotOption.slotLabel}*. The provider is being confirmed now.\n\nWe'll send you all the details shortly. 🔧`
  )

  // Notify the provider
  const provider = await db.provider.findUnique({
    where: { id: providerId },
    select: { phone: true, name: true },
  })
  if (provider?.phone) {
    await sendText(
      provider.phone,
      `✅ *Customer confirmed ${slotOption.slotLabel}!*\n\nYou've been matched for a *${categoryDisplay}* job on ${slotOption.slotLabel}. Full details will follow once the booking is processed.`
    ).catch(() => {})
  }

  // Fire-and-forget re-match with new window and preferred provider
  void triggerRematch(jobRequestId)
}

async function handleCustomerRejectedProviderSlot(
  phone: string,
  jobRequestId: string
): Promise<void> {
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: {
      id: true,
      category: true,
      altSlotNegotiationOutcome: true,
    },
  })

  if (!jobRequest || jobRequest.altSlotNegotiationOutcome != null) {
    await sendText(phone, "✅ Your response has been recorded. Reply *Hi* for status.")
    return
  }

  // Reset outcome to null — negotiation is still open, cron can retry
  await db.jobRequest.update({
    where: { id: jobRequestId },
    data: { altSlotNegotiationOutcome: null },  // keep in-flight — cron retries
  })

  const categoryDisplay = jobRequest.category.charAt(0).toUpperCase() +
    jobRequest.category.slice(1).replace(/-/g, ' ')

  await sendText(
    phone,
    `📋 *No problem.*\n\nWe'll continue searching for a *${categoryDisplay}* provider for your preferred time.\n\nReply *Hi* anytime to check your request status.`
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadSlotOption(
  dispatchDecisionId: string | null | undefined,
  slotKey: string
): Promise<SlotOption | null> {
  if (!dispatchDecisionId) return null

  const decision = await db.dispatchDecision.findUnique({
    where: { id: dispatchDecisionId },
    select: { alternativeSlotOptions: true },
  })

  if (!decision?.alternativeSlotOptions) return null

  const slots = decision.alternativeSlotOptions as unknown as SlotOption[]
  return slots.find((s) => s.slotKey === slotKey) ?? null
}

async function triggerRematch(jobRequestId: string): Promise<void> {
  try {
    const { orchestrateMatch } = await import('../matching/orchestrator')
    await orchestrateMatch(jobRequestId, { triggeredBy: 'rematch' })
  } catch (err) {
    console.error('[alt-slot] rematch trigger failed', { jobRequestId, err })
  }
}
