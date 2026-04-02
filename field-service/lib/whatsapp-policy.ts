import { db } from './db'
import { TEMPLATES } from './messaging-templates'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PolicyResult =
  | { allowed: true }
  | { allowed: false; reason: 'service_opted_out' | 'marketing_opted_out' | 'customer_not_found' | 'unknown_template' }

// ─── canSend ──────────────────────────────────────────────────────────────────

export async function canSend(phone: string, templateName: string): Promise<PolicyResult> {
  const tpl =
    templateName in TEMPLATES
      ? TEMPLATES[templateName as keyof typeof TEMPLATES]
      : undefined

  if (!tpl) {
    return { allowed: false, reason: 'unknown_template' }
  }

  const customer = await db.customer.findUnique({ where: { phone } })

  if (tpl.category === 'UTILITY') {
    if (!customer) return { allowed: false, reason: 'customer_not_found' }
    if (!customer.whatsappServiceOptIn) return { allowed: false, reason: 'service_opted_out' }
    return { allowed: true }
  }

  // MARKETING
  if (!customer || !customer.whatsappMarketingOptIn) {
    return { allowed: false, reason: customer ? 'marketing_opted_out' : 'customer_not_found' }
  }
  return { allowed: true }
}

// ─── applyOptOut ──────────────────────────────────────────────────────────────

export async function applyOptOut(
  phone: string,
  source: 'bot' | 'pwa' | 'admin' | 'webhook' | 'import',
  opts?: { actorId?: string; note?: string; serviceOptOut?: boolean },
): Promise<void> {
  const customer = await db.customer.findUnique({ where: { phone } })
  if (!customer) return

  const now = new Date()

  if (opts?.serviceOptOut) {
    const oldValue = customer.whatsappServiceOptIn
    await db.$transaction([
      db.customer.update({
        where: { id: customer.id },
        data: { whatsappServiceOptIn: false },
      }),
      db.whatsappPreferenceLog.create({
        data: {
          customerId: customer.id,
          field: 'whatsappServiceOptIn',
          oldValue,
          newValue: false,
          source,
          actorId: opts?.actorId,
          note: opts?.note,
        },
      }),
    ])
  } else {
    const oldValue = customer.whatsappMarketingOptIn
    await db.$transaction([
      db.customer.update({
        where: { id: customer.id },
        data: {
          whatsappMarketingOptIn: false,
          whatsappMarketingOptOutAt: now,
          whatsappMarketingSource: source,
          lastWhatsappPrefSyncAt: now,
        },
      }),
      db.whatsappPreferenceLog.create({
        data: {
          customerId: customer.id,
          field: 'whatsappMarketingOptIn',
          oldValue,
          newValue: false,
          source,
          actorId: opts?.actorId,
          note: opts?.note,
        },
      }),
    ])
  }
}

// ─── applyOptIn ───────────────────────────────────────────────────────────────

export async function applyOptIn(
  phone: string,
  source: 'bot' | 'pwa' | 'admin' | 'webhook' | 'import',
  opts?: { actorId?: string; note?: string },
): Promise<void> {
  const customer = await db.customer.findUnique({ where: { phone } })
  if (!customer) return

  const now = new Date()
  const oldValue = customer.whatsappMarketingOptIn

  await db.$transaction([
    db.customer.update({
      where: { id: customer.id },
      data: {
        whatsappMarketingOptIn: true,
        whatsappMarketingOptInAt: now,
        whatsappMarketingSource: source,
        lastWhatsappPrefSyncAt: now,
      },
    }),
    db.whatsappPreferenceLog.create({
      data: {
        customerId: customer.id,
        field: 'whatsappMarketingOptIn',
        oldValue,
        newValue: true,
        source,
        actorId: opts?.actorId,
        note: opts?.note,
      },
    }),
  ])
}
