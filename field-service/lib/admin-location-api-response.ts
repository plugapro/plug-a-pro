import { apiError, createApiReferenceId } from './api-response'
import { CrudActionError } from './crud-action'
import { LocationNodeInUseError } from './location-nodes'

type LocationMutationAction = 'create' | 'update' | 'delete'

function statusForCrudActionError(error: CrudActionError) {
  switch (error.code) {
    case 'UNAUTHENTICATED':
      return 401
    case 'UNAUTHORIZED':
    case 'FLAG_DISABLED':
      return 403
    case 'VALIDATION':
      return 400
    case 'NOT_FOUND':
      return 404
    case 'CONFLICT':
      return 409
    default:
      return 500
  }
}

function safeMessageForCrudActionError(error: CrudActionError) {
  switch (error.code) {
    case 'UNAUTHENTICATED':
      return 'Authentication required.'
    case 'UNAUTHORIZED':
      return 'Insufficient permissions.'
    case 'FLAG_DISABLED':
      return 'Location administration is unavailable.'
    case 'VALIDATION':
      return 'Invalid location request.'
    case 'NOT_FOUND':
      return 'Location not found.'
    case 'CONFLICT':
      return 'Location update conflicted.'
    default:
      return 'Location request failed.'
  }
}

export function adminLocationMutationError(error: unknown, action: LocationMutationAction) {
  const referenceId = createApiReferenceId()

  if (error instanceof CrudActionError) {
    console.warn('[admin-location-api] mutation rejected', {
      reference_id: referenceId,
      action,
      code: error.code,
    })
    return apiError(
      error.code,
      safeMessageForCrudActionError(error),
      statusForCrudActionError(error),
      referenceId,
      { context: { surface: 'admin_locations', action } },
    )
  }

  if (error instanceof LocationNodeInUseError) {
    console.warn('[admin-location-api] location in use', {
      reference_id: referenceId,
      action,
    })
    return apiError(
      'LOCATION_IN_USE',
      'Location is still referenced and cannot be hard-deleted.',
      400,
      referenceId,
      { context: { surface: 'admin_locations', action } },
    )
  }

  console.error('[admin-location-api] mutation failed', {
    reference_id: referenceId,
    action,
    safeErrorMessage: error instanceof Error ? error.message : String(error),
  })

  return apiError(
    `LOCATION_${action.toUpperCase()}_FAILED`,
    `Failed to ${action} location.`,
    500,
    referenceId,
    { context: { surface: 'admin_locations', action } },
  )
}
