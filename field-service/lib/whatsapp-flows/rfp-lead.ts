// ─── RFP Lead Interest handler ────────────────────────────────────────────────
// Extracted from whatsapp-bot.ts — handles a provider tapping "I'm Available"
// on an RFP (Request-For-Provider) lead notification via WhatsApp.
// Contains the P2024 connection-pool retry logic for Prisma/PgBouncer.

import { db } from '../db'
import { Prisma } from '@prisma/client'
import { sendText, sendButtons } from '../whatsapp-interactive'
// review-first → review-first-domain only; rfp-lead → review-first is intentional one-way
import { notifyCustomerRfpResponseSummary } from '../review-first'
import { createPrismaLeadRepository, type LeadRepository } from '../lead-repository'

type ProviderLeadResponseResolutionSource = 'payload' | 'context' | 'fallback'

export async function handleRfpLeadInterest(
  phone: string,
  providerId: string,
  leadId: string,
  traceId: string,
  options?: {
    inboundMessageId?: string | null
    contextMessageId?: string | null
    source?: ProviderLeadResponseResolutionSource | null
    _repo?: LeadRepository  // injectable for tests; defaults to Prisma
  },
): Promise<void> {
  const repo = options?._repo ?? createPrismaLeadRepository()
  const lead = await repo.findLeadWithJobRequest(leadId)

  if (!lead || lead.providerId !== providerId) {
    if (lead && lead.providerId !== providerId) {
      await db.auditLog.create({
        data: {
          actorId: providerId,
          actorRole: 'PROVIDER',
          action: 'CROSS_ACCOUNT_BUTTON_REPLAY',
          entityType: 'Lead',
          entityId: leadId,
          ipAddress: null,
          userAgent: null,
          before: Prisma.DbNull,
          after: { claimingProviderId: providerId, realOwnerId: lead.providerId } as Prisma.InputJsonValue,
          timestamp: new Date(),
        },
      }).catch((err) => {
        console.error('[whatsapp-bot] security audit write failed:', err)
        throw err  // surface to caller; better to fail loudly than lose a security event
      })
    }
    await sendText(phone, '⚠️ This lead could not be found or is not assigned to your account.')
    return
  }

  if (lead.expiresAt && lead.expiresAt <= new Date()) {
    await sendText(phone, '⚠️ This lead has expired. New leads will come through as jobs arise.')
    return
  }

  console.info('[whatsapp-bot] rfp_interest: request_start', {
    traceId,
    leadId: lead.id,
    providerId,
    requestId: lead.jobRequestId,
    inboundMessageId: options?.inboundMessageId ?? null,
    contextMessageId: options?.contextMessageId ?? null,
    resolutionSource: options?.source ?? null,
    leadStatus: lead.status,
    jobRequestStatus: lead.jobRequest.status,
  })

  const ref = leadId.slice(-8).toUpperCase()

  // Customer-selection short-circuit. If the JobRequest has advanced past the
  // shortlist-review window (PROVIDER_CONFIRMATION_PENDING or beyond) AND the
  // tap is coming from a sibling provider whose own lead.status hasn't already
  // moved on, the customer has picked someone else. Tell them plainly rather
  // than silently transitioning their lead to INTERESTED or replying "already
  // noted" — both of which would be misleading.
  //
  // Note on `JobRequest.status === 'MATCHED'`: that's the OPS_REVIEW
  // direct-dispatch terminal. It's intentionally excluded from `jobOpenForRfp`
  // because if a JobRequest is MATCHED, a provider was directly matched and
  // sibling RFP responses are no longer relevant. The selected provider's own
  // lead.status will already be CUSTOMER_SELECTED / PROVIDER_ACCEPTED /
  // ACCEPTED_LOCKED by then (see matching/service.ts and
  // lockAcceptedLeadAfterCreditInTransaction), so they hit the
  // `leadStatusIsTerminalForSibling` short-circuit and never fall through here.
  const jobOpenForRfp = ['MATCHING', 'SHORTLIST_READY'].includes(lead.jobRequest.status)
  const leadStatusIsTerminalForSibling =
    ['CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED', 'ACCEPTED_LOCKED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED'].includes(lead.status)
  if (!jobOpenForRfp && !leadStatusIsTerminalForSibling) {
    await sendText(phone, `This lead is no longer available — the customer has moved forward with another provider. New leads will come through as jobs arise.`)
    return
  }

  // Idempotent: already interested or already selected
  if (lead.status === 'INTERESTED') {
    await sendText(phone, `✅ Your availability for Ref ${ref} is already noted. The customer will reach out if they select you.\n\nReply *status* to check your active leads.`)
    return
  }
  // Customer has selected this provider but acceptance is not yet locked. Offer
  // the same confirm_accept / confirm_decline buttons that notifySelectedProvider
  // sends, in case that message scrolled off or never landed — handleSelectedProviderConfirmation
  // is idempotent for already-locked leads. Also surface the View lead URL fallback.
  if (['CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'].includes(lead.status)) {
    await sendButtons(
      phone,
      `🎉 The customer selected you for Ref ${ref}.\n\nAccepting deducts 1 credit and unlocks the customer's contact details.`,
      [
        { id: `confirm_accept:${leadId}`, title: 'Accept (1 credit)' },
        { id: `confirm_decline:${leadId}`, title: 'Decline' },
      ],
    )
    return
  }
  // Acceptance already finalised — provider just needs to act on the job.
  if (['ACCEPTED_LOCKED', 'ACCEPTED', 'CREDIT_APPLIED'].includes(lead.status)) {
    await sendText(phone, `✅ You've already accepted Ref ${ref}. Tap *View lead* on the previous message to see the customer's contact details and arrange the job.`)
    return
  }
  if (['DECLINED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED'].includes(lead.status)) {
    await sendText(phone, `This lead is no longer available. New leads will come through as jobs arise.`)
    return
  }
  if (!['SHORTLISTED', 'SEND_PENDING', 'SEND_FAILED', 'SENT', 'VIEWED'].includes(lead.status)) {
    console.warn('[whatsapp-bot] rfp_interest: unexpected_lead_status', {
      traceId,
      leadId,
      providerId,
      leadStatus: lead.status,
      jobRequestStatus: lead.jobRequest.status,
      leadExpiresAt: lead.expiresAt,
    })
    await sendText(phone, `We couldn't process your response right now. Reply *menu* to return to the main menu or *status* to check your active leads.\n\n_Ref: ${traceId}_`)
    return
  }

  // Fetch call-out fee: try category-specific rate first, then most recent rate
  const categorySlug = lead.jobRequest.category.trim().toLowerCase()
  const providerRate =
    (await db.providerRate.findFirst({
      where: { providerId, categorySlug },
      select: { callOutFee: true, rateNegotiable: true },
    }).catch((err) => {
      console.warn('[whatsapp-bot] rfp_interest: providerRate_fetch_failed', { traceId, leadId, providerId, error: err instanceof Error ? err.message : String(err) })
      return null
    })) ??
    (await db.providerRate.findFirst({
      where: { providerId },
      orderBy: { updatedAt: 'desc' },
      select: { callOutFee: true, rateNegotiable: true },
    }).catch((err) => {
      console.warn('[whatsapp-bot] rfp_interest: providerRate_fallback_fetch_failed', { traceId, leadId, providerId, error: err instanceof Error ? err.message : String(err) })
      return null
    }))

  const idempotencyKey = `rfp_interest:${leadId}:${providerId}`
  let alreadyRegistered = false
  let transactionError: unknown = null

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        const leadUpdate = await tx.lead.updateMany({
          where: {
            id: leadId,
            providerId,
            status: { in: ['SHORTLISTED', 'SEND_PENDING', 'SEND_FAILED', 'SENT', 'VIEWED'] },
          },
          data: { status: 'INTERESTED', respondedAt: new Date() },
        })

        if (leadUpdate.count === 0) {
          alreadyRegistered = true
          return
        }

        await tx.providerLeadResponse.create({
          data: {
            leadInviteId: leadId,
            providerId,
            response: 'INTERESTED',
            callOutFee: providerRate?.callOutFee ?? null,
            estimatedArrivalAt: null,
            negotiable: providerRate?.rateNegotiable ?? true,
            source: 'whatsapp_button',
            idempotencyKey,
          },
        })
      })
      transactionError = null
      if (!alreadyRegistered) {
        console.info('[whatsapp-bot] rfp_interest: interest registered', {
          traceId,
          leadId,
          providerId,
          prevLeadStatus: lead.status,
          inboundMessageId: options?.inboundMessageId ?? null,
          contextMessageId: options?.contextMessageId ?? null,
          resolutionSource: options?.source ?? null,
        })
      }
      break
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        // Unique constraint on idempotencyKey — concurrent tap already handled
        console.info('[whatsapp-bot] rfp_interest: concurrent_tap_deduped', { traceId, leadId, providerId })
        alreadyRegistered = true
        transactionError = null
        break
      } else if (['P2034', 'P5010', 'P2024'].includes((err as { code?: string }).code ?? '') && attempt === 0) {
        // P2034 = deadlock / write conflict; P5010 = Prisma Data Proxy pool timeout;
        // P2024 = standard Prisma client connection pool timeout (PgBouncer / Supabase).
        // Prisma explicitly recommends retrying P2034; the pool errors warrant the same.
        // Wait briefly then let the loop retry once.
        console.warn('[whatsapp-bot] rfp_interest: write_conflict_retry', { traceId, leadId, providerId, code: (err as { code?: string }).code })
        await new Promise((resolve) => setTimeout(resolve, 150))
        transactionError = err
      } else {
        transactionError = err
        break
      }
    }
  }

  if (transactionError !== null) {
    console.error('[whatsapp-bot] rfp_interest: transaction failed', {
      traceId, leadId, providerId,
      errorCode: (transactionError as { code?: string })?.code ?? 'unknown',
      error: transactionError instanceof Error ? transactionError.message : String(transactionError),
      inboundMessageId: options?.inboundMessageId ?? null,
      contextMessageId: options?.contextMessageId ?? null,
      resolutionSource: options?.source ?? null,
    })
    // Re-send only the retry button — omitting "Not Available" avoids an accidental
    // decline if the provider taps reflexively after seeing an error.
    await sendButtons(
      phone,
      `⚠️ We couldn't register your availability right now — please try again.\n\n_Ref: ${traceId}_`,
      [
        { id: `ops_accept:${leadId}:${providerId}`, title: "I'm Available" },
      ],
    )
    return
  }

  if (alreadyRegistered) {
    await sendText(phone, `✅ Your availability for Ref ${ref} is already noted. The customer will reach out if they select you.\n\nReply *status* to check your active leads.`)
    return
  }

  await sendText(
    phone,
    `✅ *Availability noted — Ref ${ref}*\n\nWe've let the customer know you're available for this job.\n\nYou'll receive a confirmation message here on WhatsApp if the customer selects you.`,
  )

  // Notify the customer that a provider responded so they can review and select
  const jobStatus = lead.jobRequest.status
  if (!['PROVIDER_CONFIRMATION_PENDING', 'MATCHED', 'CANCELLED', 'EXPIRED'].includes(jobStatus)) {
    notifyCustomerRfpResponseSummary(lead.jobRequestId).catch((err) => {
      console.warn('[whatsapp-bot] rfp_interest: customer notification failed', {
        traceId, leadId, providerId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }
}
