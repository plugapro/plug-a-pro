import type { AuthUser } from './auth'
import { isEnabled } from './flags'

type CustomerRecord = {
  id: string
  userId: string | null
  phone: string
  name: string
  email: string | null
}

type CustomerClient = {
  customer: {
    findUnique: (...args: any[]) => Promise<CustomerRecord | null>
    findFirst: (...args: any[]) => Promise<CustomerRecord | null>
    update: (...args: any[]) => Promise<CustomerRecord>
  }
  // Optional so existing test mocks that pre-date M1-T8 don't need updating.
  // When db is passed as the client (all production callers) this is always present.
  customerMember?: {
    findFirst: (...args: any[]) => Promise<{ principalCustomerId: string } | null>
  }
}

const customerSessionSelect = {
  id: true,
  userId: true,
  phone: true,
  name: true,
  email: true,
} as const

export async function resolveCustomerForSession(
  client: CustomerClient,
  session: AuthUser,
): Promise<CustomerRecord | null> {
  let customer = await client.customer.findUnique({
    where: { userId: session.id },
    select: customerSessionSelect,
  })

  if (!customer && session.phone) {
    customer = await client.customer.findUnique({
      where: { phone: session.phone },
      select: customerSessionSelect,
    })
  }

  // M1-T8: CustomerMember operator delegation.
  // Checked before self-linking so that a member's userId is never bound to the
  // principal's phone-only record. When the flag is on and the user has an active
  // membership, all session activity routes to the principal customer account.
  if (client.customerMember) {
    const memberDelegation = await resolveMemberDelegation(client, session)
    if (memberDelegation) return memberDelegation
  }

  // Self-link: bind the Supabase userId to the phone-only Customer record created
  // via WhatsApp before the user completed OTP authentication on the PWA.
  if (customer && !customer.userId) {
    customer = await client.customer.update({
      where: { id: customer.id },
      data: { userId: session.id },
      select: customerSessionSelect,
    })
  }

  return customer
}

async function resolveMemberDelegation(
  client: CustomerClient,
  session: AuthUser,
): Promise<CustomerRecord | null> {
  if (!await isEnabled('feature.customer.operator_member', { userId: session.id })) {
    return null
  }

  const orClauses: Array<Record<string, string>> = [{ memberUserId: session.id }]
  if (session.phone) orClauses.push({ memberPhone: session.phone })

  const membership = await client.customerMember!.findFirst({
    where: { OR: orClauses, active: true },
    select: { principalCustomerId: true },
  })

  if (!membership) return null

  return client.customer.findUnique({
    where: { id: membership.principalCustomerId },
    select: customerSessionSelect,
  })
}
