import { Prisma } from '@prisma/client'
import { db } from './db'
import { ensureJobRequestAccessToken, resolveJobRequestAccessToken } from './job-request-access'
import {
  allowedActionsForClientPwaScreen,
  resolveClientPwaScreenForState,
  type ClientPwaAllowedAction,
  type ClientPwaScreen,
} from './client-pwa-state'

export type ClientPwaAccessLevel = 'public_token' | 'trusted_reference' | 'invalid' | 'expired'

const clientPwaRequestSelect = Prisma.validator<Prisma.JobRequestSelect>()({
  id: true,
  customerId: true,
  category: true,
  title: true,
  description: true,
  status: true,
  assignmentMode: true,
  latestDispatchDecisionId: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  // selectedLeadInviteId is an internal routing field used only to highlight
  // the customer-selected shortlist item. It is a DB foreign key (UUID), not
  // personal data. It is included here because the ticket page needs it to
  // mark the selected card without a second query.
  selectedLeadInviteId: true,
  customer: { select: { id: true, userId: true, name: true, phone: true } },
  address: true,
  attachments: {
    where: { label: { in: ['customer_photo', 'evidence'] }, safeForPreview: true },
    orderBy: { createdAt: 'asc' },
  },
  leads: {
    include: {
      provider: {
        select: {
          id: true,
          name: true,
          skills: true,
        },
      },
    },
    orderBy: { sentAt: 'desc' },
  },
  match: {
    include: {
      provider: {
        select: {
          id: true,
          name: true,
          bio: true,
          experience: true,
          skills: true,
          serviceAreas: true,
          evidenceNote: true,
          portfolioUrls: true,
          verified: true,
        },
      },
      quotes: {
        orderBy: { createdAt: 'desc' },
      },
      booking: {
        include: {
          quote: true,
          payment: true,
          job: {
            include: {
              photos: {
                orderBy: { createdAt: 'asc' },
              },
              extras: {
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      },
    },
  },
})

export type ClientPwaDestinationRequest = Prisma.JobRequestGetPayload<{
  select: typeof clientPwaRequestSelect
}>

export type ClientPwaDestinationJob = NonNullable<
  NonNullable<NonNullable<ClientPwaDestinationRequest['match']>['booking']>['job']
>

export type ClientPwaDestination = {
  screen: ClientPwaScreen
  route: string
  request: ClientPwaDestinationRequest | null
  job: ClientPwaDestinationJob | null
  allowedActions: ClientPwaAllowedAction[]
  accessLevel: ClientPwaAccessLevel
  reason: string
}

// Resolve token, request id, or job id entry points into the one current PWA destination.
export async function resolveClientPwaDestination(params: {
  token?: string | null
  requestId?: string | null
  jobId?: string | null
  intendedScreen?: string | null
}): Promise<ClientPwaDestination> {
  if (params.token) {
    return resolveTokenDestination(params.token)
  }

  if (params.requestId) {
    const request = await db.jobRequest.findUnique({
      where: { id: params.requestId },
      select: clientPwaRequestSelect,
    })
    return request ? buildDestination({ request, accessLevel: 'trusted_reference' }) : invalidDestination('request_not_found')
  }

  if (params.jobId) {
    const job = await db.job.findUnique({
      where: { id: params.jobId },
      select: { booking: { select: { match: { select: { jobRequestId: true } } } } },
    })
    const requestId = job?.booking?.match.jobRequestId

    if (!requestId) {
      return invalidDestination('job_reference_not_found')
    }

    return resolveClientPwaDestination({ requestId, intendedScreen: params.intendedScreen })
  }

  return {
    screen: 'client_home',
    route: '/bookings',
    request: null,
    job: null,
    allowedActions: allowedActionsForClientPwaScreen('client_home'),
    accessLevel: 'trusted_reference',
    reason: 'no_active_request',
  }
}

async function resolveTokenDestination(token: string): Promise<ClientPwaDestination> {
  const resolved = await resolveJobRequestAccessToken(token)

  if (resolved.status === 'invalid' || !resolved.jobRequest) {
    return invalidDestination('token_not_found')
  }

  if (resolved.status === 'expired') {
    return {
      screen: 'expired',
      route: '/requests/access/recovery?reason=expired',
      request: resolved.jobRequest as ClientPwaDestinationRequest,
      job: null,
      allowedActions: allowedActionsForClientPwaScreen('expired'),
      accessLevel: 'expired',
      reason: 'token_expired_or_revoked',
    }
  }

  return buildDestination({
    request: resolved.jobRequest as ClientPwaDestinationRequest,
    token,
    accessLevel: 'public_token',
  })
}

function buildDestination(params: {
  request: ClientPwaDestinationRequest
  token?: string
  accessLevel: Extract<ClientPwaAccessLevel, 'public_token' | 'trusted_reference'>
}): ClientPwaDestination {
  const job = params.request.match?.booking?.job ?? null
  const state = resolveClientPwaScreenForState({
    requestStatus: params.request.status,
    jobStatus: job?.status ?? null,
  })

  return {
    screen: state.screen,
    route: routeForClientPwaScreen({
      screen: state.screen,
      request: params.request,
      job,
      token: params.token,
    }),
    request: params.request,
    job,
    allowedActions: allowedActionsForClientPwaScreen(state.screen),
    accessLevel: params.accessLevel,
    reason: state.reason,
  }
}

function routeForClientPwaScreen(params: {
  screen: ClientPwaScreen
  request: ClientPwaDestinationRequest
  job: ClientPwaDestinationJob | null
  token?: string
}) {
  if (params.token) {
    return `/requests/access/${encodeURIComponent(params.token)}?view=${encodeURIComponent(params.screen)}`
  }

  const bookingId = params.request.match?.booking?.id

  if (params.screen === 'completion_review' && bookingId) {
    return `/bookings/${bookingId}/rate`
  }

  if ((params.screen === 'job_tracking' || params.screen === 'active_job') && bookingId) {
    return `/bookings/${bookingId}`
  }

  return `/requests/${params.request.id}?view=${encodeURIComponent(params.screen)}`
}

function invalidDestination(reason: string): ClientPwaDestination {
  return {
    screen: 'invalid_link',
    route: '/requests/access/recovery?reason=invalid',
    request: null,
    job: null,
    allowedActions: allowedActionsForClientPwaScreen('invalid_link'),
    accessLevel: 'invalid',
    reason,
  }
}

// Server-side helpers can use this when they have an internal request reference but need a browser-safe route.
export async function resolveClientPwaDestinationFromRequestReference(params: {
  requestId: string
  intendedScreen?: string | null
}) {
  const access = await ensureJobRequestAccessToken(params.requestId)
  return resolveClientPwaDestination({ token: access.token, intendedScreen: params.intendedScreen })
}
