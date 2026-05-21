'use server'

// ─── Customer: Saved sites (CustomerAddress) server actions ───────────────────

import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { recordAuditLog } from '@/lib/audit'
import { resolveSuburbNodeId } from '@/lib/location-nodes'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'

const siteSchema = z.object({
  label:      z.string().optional(),
  street:     z.string().min(1, 'Street address is required'),
  suburb:     z.string().min(1, 'Suburb is required'),
  city:       z.string().min(1, 'City is required'),
  province:   z.string().min(1, 'Province is required'),
  postalCode: z.string().optional(),
})

export type SiteInput = z.infer<typeof siteSchema>

async function requireCustomer() {
  const session = await getSession()
  if (!session) throw new Error('Not authenticated')
  const customer = await resolveCustomerForSession(db, session)
  if (!customer) throw new Error('No customer record found')
  return { customer, session }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createCustomerSiteAction(data: SiteInput) {
  const { customer, session } = await requireCustomer()
  const parsed = siteSchema.parse(data)

  // Resolve locationNodeId so the booking flow validator can skip the manual region check
  const locationNodeId = await resolveSuburbNodeId(parsed.suburb, parsed.city).catch(() => null)

  // Deduplicate: return existing row if same physical address is already saved
  const duplicate = await db.customerAddress.findFirst({
    where: {
      customerId: customer.id,
      street:   { equals: parsed.street,   mode: 'insensitive' },
      suburb:   { equals: parsed.suburb,   mode: 'insensitive' },
      city:     { equals: parsed.city,     mode: 'insensitive' },
      province: { equals: parsed.province, mode: 'insensitive' },
    },
  })
  if (duplicate) {
    return { success: true, site: duplicate }
  }

  // First site becomes the default automatically
  const existingCount = await db.customerAddress.count({
    where: { customerId: customer.id },
  })
  const isDefault = existingCount === 0

  const site = await db.customerAddress.create({
    data: {
      customerId: customer.id,
      ...parsed,
      locationNodeId: locationNodeId ?? null,
      isDefault,
    },
  })

  await recordAuditLog({
    actorId:    session.id,
    actorRole:  'customer',
    action:     'create',
    entityType: 'CustomerAddress',
    entityId:   site.id,
  })

  revalidatePath('/account/sites')
  return { success: true, site }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateCustomerSiteAction(siteId: string, data: SiteInput) {
  const { customer } = await requireCustomer()
  const parsed = siteSchema.parse(data)

  const existing = await db.customerAddress.findFirst({
    where: { id: siteId, customerId: customer.id },
  })
  if (!existing) throw new Error('Site not found')

  const site = await db.customerAddress.update({
    where: { id: siteId },
    data:  parsed,
  })

  revalidatePath('/account/sites')
  return { success: true, site }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteCustomerSiteAction(siteId: string) {
  const { customer, session } = await requireCustomer()

  const existing = await db.customerAddress.findFirst({
    where: { id: siteId, customerId: customer.id },
  })
  if (!existing) throw new Error('Site not found')

  await db.customerAddress.delete({ where: { id: siteId } })

  // If the deleted site was the default, promote the oldest remaining site
  if (existing.isDefault) {
    const next = await db.customerAddress.findFirst({
      where:   { customerId: customer.id },
      orderBy: { createdAt: 'asc' },
    })
    if (next) {
      await db.customerAddress.update({
        where: { id: next.id },
        data:  { isDefault: true },
      })
    }
  }

  await recordAuditLog({
    actorId:    session.id,
    actorRole:  'customer',
    action:     'delete',
    entityType: 'CustomerAddress',
    entityId:   siteId,
  })

  revalidatePath('/account/sites')
  return { success: true }
}

// ─── Set default ─────────────────────────────────────────────────────────────

export async function setDefaultCustomerSiteAction(siteId: string) {
  const { customer } = await requireCustomer()

  const existing = await db.customerAddress.findFirst({
    where: { id: siteId, customerId: customer.id },
  })
  if (!existing) throw new Error('Site not found')

  await db.$transaction([
    db.customerAddress.updateMany({
      where: { customerId: customer.id },
      data:  { isDefault: false },
    }),
    db.customerAddress.update({
      where: { id: siteId },
      data:  { isDefault: true },
    }),
  ])

  revalidatePath('/account/sites')
  return { success: true }
}
