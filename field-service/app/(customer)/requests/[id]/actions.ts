'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { db } from '@/lib/db'
import { processQuoteDecision } from '@/lib/quotes'
import {
  cancelRequestFromShortlist,
  requestMoreShortlistOptions,
  selectProviderForCustomerRequest,
  selectShortlistedProviderForRequest,
  CustomerShortlistError,
} from '@/lib/customer-shortlists'
import {
  selectCustomerRequestMatchingMode,
  type CustomerMatchingMode,
} from '@/lib/request-matching-mode'
import {
  ReviewFirstError,
  shortlistProviderForCustomerReview,
  sendRequestToShortlistedProviders,
} from '@/lib/review-first'

async function resolveCustomerPhone(): Promise<string | null> {
  const session = await getSession()
  if (!session) return null
  const customer = await resolveCustomerForSession(db, session)
  return customer?.phone ?? null
}

/**
 * Verify the authenticated session owns the given request.
 * Returns the customer id if access is allowed, null otherwise.
 */
async function resolveCustomerIdForRequest(
  requestId: string,
): Promise<string | null> {
  const normalizedRequestId = requestId?.trim()
  if (!normalizedRequestId) return null
  const session = await getSession()
  if (!session || session.role !== 'customer') return null
  const customer = await resolveCustomerForSession(db, session)
  if (!customer) return null
  const request = await db.jobRequest.findUnique({
    where: { id: normalizedRequestId },
    select: { customerId: true },
  })
  if (!request || request.customerId !== customer.id) return null
  return customer.id
}

function normalizeActionInput(value: string | undefined | null) {
  return value?.trim()
}

export async function selectShortlistProviderAction(
  requestId: string,
  shortlistItemId: string,
  _formData: FormData,
): Promise<void> {
  const normalizedRequestId = requestId?.trim()
  const normalizedShortlistItemId = shortlistItemId?.trim()
  if (!normalizedRequestId || !normalizedShortlistItemId) {
    throw new Error('Invalid selection request')
  }

  const customerId = await resolveCustomerIdForRequest(normalizedRequestId)
  if (!customerId) throw new Error('Not authenticated')

  try {
    await selectShortlistedProviderForRequest({
      requestId: normalizedRequestId,
      shortlistItemId: normalizedShortlistItemId,
    })
  } catch (err) {
    if (err instanceof CustomerShortlistError) throw err
    throw new Error('Selection could not be completed. Please try again.')
  }

  revalidatePath(`/requests/${normalizedRequestId}`)
}

export async function selectMatchedProviderAction(
  requestId: string,
  providerId: string,
  _formData: FormData,
): Promise<void> {
  const normalizedRequestId = requestId?.trim()
  const normalizedProviderId = providerId?.trim()
  if (!normalizedRequestId || !normalizedProviderId) {
    throw new Error('Invalid selection request')
  }

  const customerId = await resolveCustomerIdForRequest(normalizedRequestId)
  if (!customerId) throw new Error('Not authenticated')

  try {
    await selectProviderForCustomerRequest({
      requestId: normalizedRequestId,
      customerId,
      providerId: normalizedProviderId,
    })
  } catch (err) {
    if (err instanceof CustomerShortlistError) throw err
    throw new Error('Selection could not be completed. Please try again.')
  }

  revalidatePath(`/requests/${normalizedRequestId}`)
}

export async function requestMoreShortlistOptionsAction(
  requestId: string,
  _formData: FormData,
): Promise<void> {
  const normalizedRequestId = normalizeActionInput(requestId)
  if (!normalizedRequestId) throw new Error('Invalid request')

  const customerId = await resolveCustomerIdForRequest(normalizedRequestId)
  if (!customerId) throw new Error('Not authenticated')

  try {
    await requestMoreShortlistOptions({ requestId: normalizedRequestId })
  } catch (err) {
    if (err instanceof CustomerShortlistError) throw err
    throw new Error('Could not request more options. Please try again.')
  }

  revalidatePath(`/requests/${normalizedRequestId}`)
}

export async function cancelRequestFromShortlistAction(
  requestId: string,
  _formData: FormData,
): Promise<void> {
  const normalizedRequestId = normalizeActionInput(requestId)
  if (!normalizedRequestId) throw new Error('Invalid request')

  const customerId = await resolveCustomerIdForRequest(normalizedRequestId)
  if (!customerId) throw new Error('Not authenticated')

  try {
    await cancelRequestFromShortlist({ requestId: normalizedRequestId })
  } catch (err) {
    if (err instanceof CustomerShortlistError) throw err
    throw new Error('Could not cancel the request. Please try again.')
  }

  revalidatePath(`/requests/${normalizedRequestId}`)
  revalidatePath('/bookings')
}

export async function chooseMatchingModeAction(
  requestId: string,
  mode: CustomerMatchingMode,
  _formData: FormData,
): Promise<void> {
  const normalizedRequestId = normalizeActionInput(requestId)
  if (!normalizedRequestId) throw new Error('Invalid request')

  const customerId = await resolveCustomerIdForRequest(normalizedRequestId)
  if (!customerId) throw new Error('Not authenticated')
  await selectCustomerRequestMatchingMode({ requestId: normalizedRequestId, customerId, mode })
  revalidatePath(`/requests/${normalizedRequestId}`)
  revalidatePath('/bookings')
}

export async function shortlistReviewProviderAction(
  requestId: string,
  providerId: string,
  _formData: FormData,
): Promise<void> {
  const normalizedRequestId = normalizeActionInput(requestId)
  const normalizedProviderId = normalizeActionInput(providerId)
  if (!normalizedRequestId || !normalizedProviderId) {
    throw new Error('Invalid shortlist request')
  }

  const customerId = await resolveCustomerIdForRequest(normalizedRequestId)
  if (!customerId) throw new Error('Not authenticated')
  try {
    await shortlistProviderForCustomerReview({
      requestId: normalizedRequestId,
      customerId,
      providerId: normalizedProviderId,
    })
  } catch (error) {
    if (error instanceof ReviewFirstError) throw error
    throw new Error('Could not shortlist provider right now.')
  }
  revalidatePath(`/requests/${normalizedRequestId}`)
}

export async function sendReviewShortlistAction(
  requestId: string,
  _formData: FormData,
): Promise<void> {
  const normalizedRequestId = normalizeActionInput(requestId)
  if (!normalizedRequestId) throw new Error('Invalid request')

  const customerId = await resolveCustomerIdForRequest(normalizedRequestId)
  if (!customerId) throw new Error('Not authenticated')
  try {
    await sendRequestToShortlistedProviders({ requestId: normalizedRequestId, customerId })
  } catch (error) {
    if (error instanceof ReviewFirstError) throw error
    throw new Error('Could not send request to shortlisted providers.')
  }
  revalidatePath(`/requests/${normalizedRequestId}`)
  revalidatePath('/bookings')
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

  const normalizedRequestId = normalizeActionInput(requestId)
  if (!normalizedRequestId) return { error: 'Invalid request' }

  revalidatePath(`/requests/${normalizedRequestId}`)
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

  const normalizedRequestId = normalizeActionInput(requestId)
  if (!normalizedRequestId) return { error: 'Invalid request' }

  revalidatePath(`/requests/${normalizedRequestId}`)
  revalidatePath('/bookings')
  return {}
}
