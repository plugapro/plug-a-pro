import type { JobStatus } from '@prisma/client'

export type ClientPwaJobTrackingStep = {
  key: string
  label: string
  description: string
  done: boolean
  current: boolean
}

const CLIENT_JOB_TRACKING_STEPS = [
  { key: 'REQUEST_SUBMITTED', label: 'Request submitted', description: 'We received your request.' },
  { key: 'PROVIDERS_MATCHED', label: 'Providers matched', description: 'Suitable providers reviewed your request.' },
  { key: 'CUSTOMER_SELECTED', label: 'You selected provider', description: 'Your selected provider was asked to confirm on WhatsApp.' },
  { key: 'PROVIDER_ACCEPTED', label: 'Provider accepted', description: 'Your provider accepted the job.' },
  { key: 'ARRIVAL_CONFIRMED', label: 'Arrival time confirmed', description: 'Arrival details are confirmed.' },
  { key: 'EN_ROUTE', label: 'Provider on the way', description: 'Your provider is travelling to you.' },
  { key: 'ARRIVED', label: 'Provider arrived', description: 'Your provider is on site.' },
  { key: 'STARTED', label: 'Job in progress', description: 'Work is in progress.' },
  { key: 'COMPLETED', label: 'Job completed', description: 'Please confirm everything is in order.' },
]

// Build customer-facing timeline progress from the same Job fields updated by
// provider WhatsApp commands, so the PWA reflects WhatsApp-complete execution.
export function buildClientPwaJobTrackingSteps(params: {
  status: JobStatus | null
  arrivalTimeConfirmedAt?: Date | string | null
}): ClientPwaJobTrackingStep[] {
  const currentIndex = indexForJobTrackingState(params)

  return CLIENT_JOB_TRACKING_STEPS.map((step, index) => ({
    ...step,
    done: index < currentIndex,
    current: index === currentIndex,
  }))
}

function indexForJobTrackingState(params: {
  status: JobStatus | null
  arrivalTimeConfirmedAt?: Date | string | null
}) {
  if (!params.status) return 3

  switch (params.status) {
    case 'SCHEDULED':
      return params.arrivalTimeConfirmedAt ? 4 : 3
    case 'EN_ROUTE':
      return 5
    case 'ARRIVED':
      return 6
    case 'STARTED':
    case 'PAUSED':
    case 'AWAITING_APPROVAL':
      return 7
    case 'PENDING_COMPLETION_CONFIRMATION':
    case 'COMPLETED':
      return 8
    case 'CALLBACK_REQUIRED':
    case 'CANCELLED':
    case 'FAILED':
      return 7
  }
}
