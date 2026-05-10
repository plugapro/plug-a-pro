import { resolveClientPwaDestination, type ClientPwaDestination } from './client-pwa-destination'
import { getCustomerShortlistForRequest } from './customer-shortlists'
import { createTraceId } from './support-diagnostics'

type ShortlistShape = Awaited<ReturnType<typeof getCustomerShortlistForRequest>>

export type CustomerRequestTicketViewModel =
  | {
      kind: 'ready'
      traceId: string
      token: string
      destination: ClientPwaDestination
      shortlist: ShortlistShape
    }
  | {
      kind: 'unavailable'
      traceId: string
      token: string
      reason: 'expired' | 'invalid' | 'resolve_failed'
      destination: ClientPwaDestination | null
    }

/**
 * Resolve a WhatsApp request-status token into a crash-safe ticket model.
 * Any resolver/query failure must degrade to a controlled unavailable state.
 */
export async function buildCustomerRequestTicketViewModel(params: {
  token: string
  intendedScreen?: string | null
}): Promise<CustomerRequestTicketViewModel> {
  const traceId = createTraceId('tkt')
  const token = params.token

  let destination: ClientPwaDestination | null = null
  try {
    destination = await resolveClientPwaDestination({
      token,
      intendedScreen: params.intendedScreen ?? null,
    })
  } catch (error) {
    // Resolver failures (schema drift, stale enum values, relation decode errors)
    // should not crash the whole PWA shell for old WhatsApp links.
    console.error('[ticket-access] destination resolve failed', {
      traceId,
      route: '/requests/access/[token]',
      tokenStatus: 'resolve_failed',
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      kind: 'unavailable',
      traceId,
      token,
      reason: 'resolve_failed',
      destination: null,
    }
  }

  if (destination.accessLevel !== 'public_token' || !destination.request) {
    const reason = destination.accessLevel === 'expired' ? 'expired' : 'invalid'
    console.info('[ticket-access] token unavailable state', {
      traceId,
      route: '/requests/access/[token]',
      tokenStatus: destination.accessLevel,
      destinationScreen: destination.screen,
      destinationReason: destination.reason,
      requestId: destination.request?.id ?? null,
      requestStatus: destination.request?.status ?? null,
    })
    return {
      kind: 'unavailable',
      traceId,
      token,
      reason,
      destination,
    }
  }

  let shortlist: ShortlistShape = null
  try {
    shortlist = await getCustomerShortlistForRequest(destination.request.id)
  } catch (error) {
    // Shortlist is optional for most request states; suppress fetch failures and
    // continue rendering the ticket status page.
    console.warn('[ticket-access] shortlist fetch failed (non-fatal)', {
      traceId,
      route: '/requests/access/[token]',
      requestId: destination.request.id,
      requestStatus: destination.request.status,
      error: error instanceof Error ? error.message : String(error),
    })
    shortlist = null
  }

  console.info('[ticket-access] ticket view model ready', {
    traceId,
    route: '/requests/access/[token]',
    requestId: destination.request.id,
    requestStatus: destination.request.status,
    matchingMode: destination.request.assignmentMode,
    destinationScreen: destination.screen,
    destinationReason: destination.reason,
    shortlistItems: shortlist?.items.length ?? 0,
  })

  return {
    kind: 'ready',
    traceId,
    token,
    destination,
    shortlist,
  }
}
