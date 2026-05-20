import type { AuthUser } from './auth'
import { isEnabled } from './flags'

type CustomerRecord = {
  id: string
  userId: string | null
  phone: string
  name: string
  email: string | null
  isBlocked: boolean
}

type CustomerMemberClient = {
  findFirst: (...args: any[]) => Promise<{ principalCustomerId: string } | null>
}

type CustomerClient = {
  customer: {
    findUnique: (...args: any[]) => Promise<CustomerRecord | null>
    findFirst: (...args: any[]) => Promise<CustomerRecord | null>
    update: (...args: any[]) => Promise<CustomerRecord>
  }
  // Optional so existing test mocks that pre-date M1-T8 don't need updating.
  // When db is passed as the client (all production callers) this is always present.
  customerMember?: CustomerMemberClient
}

const customerSessionSelect = {
  id: true,
  userId: true,
  phone: true,
  name: true,
  email: true,
  isBlocked: true,
} as const

export async function resolveCustomerForSession(
  client: CustomerClient,
  session: AuthUser,
): Promise<CustomerRecord | null> {
  let customer = await client.customer.findUnique({
    where: { userId: session.id },
    select: customerSessionSelect,
  })

  // M1-T8: CustomerMember operator delegation.
  // Runs AFTER the userId lookup but BEFORE the phone lookup so that a member's
  // userId is never self-linked to a phone-only principal record via the fallback
  // path. When an active membership exists the session resolves to the principal
  // customer account — per spec, members always book under the company account
  // regardless of whether they also have their own Customer row.
  if (client.customerMember) {
    try {
      const memberDelegation = await resolveMemberDelegation(client.customerMember, client.customer, session)
      if (memberDelegation) return memberDelegation
    } catch (err) {
      // Delegation is best-effort. A transient DB or flag error must not block
      // a customer who has a valid direct account from resolving their session.
      console.error('[customer-session] resolveMemberDelegation failed, falling back', err)
    }
  }

  if (!customer && session.phone) {
    customer = await client.customer.findUnique({
      where: { phone: session.phone },
      select: customerSessionSelect,
    })
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
  memberClient: CustomerMemberClient,
  customerClient: CustomerClient['customer'],
  session: AuthUser,
): Promise<CustomerRecord | null> {
  if (!await isEnabled('feature.customer.operator_member', { userId: session.id })) {
    return null
  }

  // memberUserId is non-nullable in the schema, so userId is always the authoritative
  // lookup key. Phone-based matching is omitted to prevent SIM-swap privilege escalation.
  const membership = await memberClient.findFirst({
    where: { memberUserId: session.id, active: true },
    select: { principalCustomerId: true },
  })

  if (!membership) return null

  return customerClient.findUnique({
    where: { id: membership.principalCustomerId },
    select: customerSessionSelect,
  })
}
