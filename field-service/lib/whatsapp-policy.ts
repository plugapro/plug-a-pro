// lib/whatsapp-policy.ts
// Central enforcement gate for all outbound WhatsApp messages.
//
// Usage:
//   const check = await canSend(phone, 'booking_confirmation')
//   if (!check.allowed) { console.log(check.reason); return }
//
//   await applyOptOut(phone, 'bot')   // STOP keyword in bot
//   await applyOptIn(phone, 'pwa')    // customer enabled toggle
//
// Phone numbers must be in E.164 format (e.g. +27821234567).
// Callers are responsible for normalising phone numbers before calling.

import { db } from './db'
import { TEMPLATES, TemplateName } from './messaging-templates'
import { maskPhone } from './support-diagnostics'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PolicyResult =
  | { allowed: true }
  | { allowed: false; reason: 'service_opted_out' | 'marketing_opted_out' | 'customer_not_found' | 'provider_not_found' | 'unknown_template' | 'db_error' }

// ─── canSend ──────────────────────────────────────────────────────────────────

export async function canSend(phone: string, templateName: TemplateName): Promise<PolicyResult> {
  const tpl =
    templateName in TEMPLATES
      ? TEMPLATES[templateName as keyof typeof TEMPLATES]
      : undefined

  if (!tpl) {
    return { allowed: false, reason: 'unknown_template' }
  }

  try {
    const customer = await db.customer.findUnique({ where: { phone } })

    if (tpl.category === 'UTILITY') {
      if (!customer) return { allowed: false, reason: 'customer_not_found' }
      if (!customer.whatsappServiceOptIn) return { allowed: false, reason: 'service_opted_out' }
      return { allowed: true }
    }

    // MARKETING - check customer first, then fall back to provider
    if (customer) {
      return customer.whatsappMarketingOptIn
        ? { allowed: true }
        : { allowed: false, reason: 'marketing_opted_out' }
    }

    const provider = await db.provider.findUnique({ where: { phone } })
    if (!provider) return { allowed: false, reason: 'provider_not_found' }
    return provider.whatsappMarketingOptIn
      ? { allowed: true }
      : { allowed: false, reason: 'marketing_opted_out' }
  } catch {
    return { allowed: false, reason: 'db_error' }
  }
}

// ─── applyOptOut ──────────────────────────────────────────────────────────────

export async function applyOptOut(
  phone: string,
  source: 'bot' | 'pwa' | 'admin' | 'webhook' | 'import',
  opts?: { actorId?: string; note?: string; serviceOptOut?: boolean },
): Promise<void> {
  const customer = await db.customer.findUnique({ where: { phone } })
  if (!customer) {
    console.warn(`[whatsapp-policy] applyOptOut: customer not found for phone ${maskPhone(phone)}`)
    return
  }

  const now = new Date()

  if (opts?.serviceOptOut) {
    await db.$transaction(async (tx) => {
      const current = await tx.customer.findUnique({
        where: { id: customer.id },
        select: { whatsappMarketingOptIn: true, whatsappServiceOptIn: true },
      })
      if (!current) return

      const oldValue = current.whatsappServiceOptIn

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          whatsappServiceOptIn: false,
          lastWhatsappPrefSyncAt: now,
        },
      })
      await tx.whatsappPreferenceLog.create({
        data: {
          customerId: customer.id,
          field: 'whatsappServiceOptIn',
          oldValue,
          newValue: false,
          source,
          actorId: opts?.actorId,
          note: opts?.note,
        },
      })
    })
  } else {
    await db.$transaction(async (tx) => {
      const current = await tx.customer.findUnique({
        where: { id: customer.id },
        select: { whatsappMarketingOptIn: true, whatsappServiceOptIn: true },
      })
      if (!current) return

      const oldValue = current.whatsappMarketingOptIn

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          whatsappMarketingOptIn: false,
          whatsappMarketingOptOutAt: now,
          whatsappMarketingSource: source,
          lastWhatsappPrefSyncAt: now,
        },
      })
      await tx.whatsappPreferenceLog.create({
        data: {
          customerId: customer.id,
          field: 'whatsappMarketingOptIn',
          oldValue,
          newValue: false,
          source,
          actorId: opts?.actorId,
          note: opts?.note,
        },
      })
    })
  }
}

// ─── applyOptIn ───────────────────────────────────────────────────────────────

export async function applyOptIn(
  phone: string,
  source: 'bot' | 'pwa' | 'admin' | 'webhook' | 'import',
  opts?: { actorId?: string; note?: string },
): Promise<void> {
  const customer = await db.customer.findUnique({ where: { phone } })
  if (!customer) {
    console.warn(`[whatsapp-policy] applyOptIn: customer not found for phone ${maskPhone(phone)}`)
    return
  }

  const now = new Date()

  await db.$transaction(async (tx) => {
    const current = await tx.customer.findUnique({
      where: { id: customer.id },
      select: { whatsappMarketingOptIn: true, whatsappServiceOptIn: true },
    })
    if (!current) return

    const oldValue = current.whatsappMarketingOptIn

    await tx.customer.update({
      where: { id: customer.id },
      data: {
        whatsappMarketingOptIn: true,
        whatsappMarketingOptInAt: now,
        whatsappMarketingSource: source,
        lastWhatsappPrefSyncAt: now,
      },
    })
    await tx.whatsappPreferenceLog.create({
      data: {
        customerId: customer.id,
        field: 'whatsappMarketingOptIn',
        oldValue,
        newValue: true,
        source,
        actorId: opts?.actorId,
        note: opts?.note,
      },
    })
  })
}
