type ApplicationStatus =
  | 'NONE'
  | 'PENDING'
  | 'MORE_INFO_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'

type ProviderStatus = 'APPLICATION_PENDING' | 'UNDER_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | 'BANNED'

type RegistrationDestinationInput = {
  applicationStatus?: ApplicationStatus | string | null
  providerStatus?: ProviderStatus | string | null
  hasActiveDraft?: boolean
  lastCompletedStep?: number | null
}

type RegistrationDestination = {
  route: string
  state?: 'pending' | 'more_info' | 'approved' | 'rejected' | 'cancelled'
}

const STEP_ROUTES: Record<number, string> = {
  0: '/provider/register/phone',
  1: '/provider/register/profile',
  2: '/provider/register/services',
  3: '/provider/register/area',
  4: '/provider/register/availability',
  5: '/provider/register/verify',
  6: '/provider/register/evidence',
  7: '/provider/register/review',
  8: '/provider/register/review',
}

function nextDraftRoute(lastCompletedStep?: number | null): string {
  const completedStep = Math.max(0, Math.min(8, Number(lastCompletedStep ?? 0)))
  return STEP_ROUTES[completedStep] ?? STEP_ROUTES[0]
}

export function resolveProviderRegistrationDestination(
  input: RegistrationDestinationInput,
): RegistrationDestination {
  if (input.applicationStatus === 'MORE_INFO_REQUIRED') {
    return { route: '/provider/register/status', state: 'more_info' }
  }

  if (input.applicationStatus === 'REJECTED') {
    return { route: '/provider/register/status', state: 'rejected' }
  }

  if (input.applicationStatus === 'CANCELLED') {
    return { route: '/provider/register/status', state: 'cancelled' }
  }

  if (input.providerStatus === 'ACTIVE' || input.applicationStatus === 'APPROVED') {
    return { route: '/provider/register/status', state: 'approved' }
  }

  if (input.applicationStatus === 'PENDING') {
    return { route: '/provider/register/status', state: 'pending' }
  }

  if (input.hasActiveDraft) {
    return { route: nextDraftRoute(input.lastCompletedStep) }
  }

  return { route: '/provider/register/welcome' }
}
