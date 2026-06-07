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
  state?: 'draft' | 'pending' | 'more_info' | 'approved' | 'rejected' | 'cancelled'
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

  if (input.applicationStatus === 'APPROVED') {
    return { route: '/provider/register/status', state: 'approved' }
  }

  if (input.providerStatus === 'ACTIVE') {
    return { route: '/provider' }
  }

  if (input.applicationStatus === 'PENDING') {
    return { route: '/provider/register/status', state: 'pending' }
  }

  if (input.hasActiveDraft) {
    return { route: '/provider/register/draft', state: 'draft' }
  }

  return { route: '/provider/register/welcome' }
}
