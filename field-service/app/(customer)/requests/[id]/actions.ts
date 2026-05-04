'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import { processQuoteDecision } from '@/lib/quotes'

async function resolveCustomerPhone(): Promise<string | null> {
  const session = await getSession()
  if (!session) return null
  const customer = await resolveCustomerForSession(db, session)
  return customer?.phone ?? null
}

export async function approveQuoteAction(
  quoteId: string,
  requestId: string,
): Promise<{ error?: string }> {
  const customerPhone = await resolveCustomerPhone()
  if (!customerPhone) return { error: 'Not authenticated' }

  const result = await processQuoteDecision(quoteId, 'approve', {
    verifyCustomerPhone: customerPhone,
  })

  if ('error' in result) return { error: result.error }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/bookings')
  return {}
}

export async function declineQuoteAction(
  quoteId: string,
  requestId: string,
): Promise<{ error?: string }> {
  const customerPhone = await resolveCustomerPhone()
  if (!customerPhone) return { error: 'Not authenticated' }

  const result = await processQuoteDecision(quoteId, 'decline', {
    verifyCustomerPhone: customerPhone,
  })

  if ('error' in result) return { error: result.error }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/bookings')
  return {}
}
