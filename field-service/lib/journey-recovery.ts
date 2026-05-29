// ─── User-journey recovery taxonomy + resolver ──────────────────────────────
// Central rule: a customer, provider or technician should always know what
// happened, whether progress was saved and what they can do next.

import { createTraceId, maskPhone, safeErrorMessage } from './support-diagnostics'
import type { QuickReply } from './whatsapp-interactive'
import { sendButtons, sendText } from './whatsapp-interactive'
import type { FlowName, FlowStep } from './whatsapp-flows/types'
import { ctaLabelFor } from './whatsapp-copy'

export type JourneyUserRole = 'customer' | 'provider' | 'technician' | 'admin' | 'unknown'

export type JourneyChannel = 'whatsapp' | 'pwa' | 'admin'

export type JourneyFailureType =
  | 'validation_error'
  | 'missing_input'
  | 'invalid_selection'
  | 'stale_action'
  | 'expired_session'
  | 'state_mismatch'
  | 'dependency_failure'
  | 'database_failure'
  | 'storage_failure'
  | 'media_processing_failure'
  | 'matching_failure'
  | 'no_results'
  | 'permission_denied'
  | 'rate_limited'
  | 'external_service_failure'
  | 'unexpected_error'

export type JourneyRecoveryClass =
  | 'retry_same_step'
  | 'resume_step'
  | 'show_status'
  | 'return_main_menu'
  | 'start_again'
  | 'contact_support'
  | 'manual_review'
  | 'wait_and_notify'

export type JourneyRecoveryActionId =
  | 'flow_continue'
  | 'retry_step'
  | 'status'
  | 'book'
  | 'cancel_flow'
  | 'start_cancel'
  | 'back_home'
  | 'session_restart'
  | 'provider_support'
  | 'provider_my_jobs'

export type JourneyRecoveryAction = {
  id: JourneyRecoveryActionId
  title: string
}

export type ResolveJourneyRecoveryInput = {
  userRole: JourneyUserRole
  channel: JourneyChannel
  flowName: FlowName | string
  currentStep: FlowStep | string
  failureType: JourneyFailureType
  recoveryClass?: JourneyRecoveryClass
  requestId?: string | null
  applicationId?: string | null
  jobId?: string | null
  actionId?: string | null
  messageId?: string | null
  lastKnownState?: string | null
  phone?: string | null
  traceId?: string
  error?: unknown
}

export type JourneyRecoveryPlan = {
  traceId: string
  failureType: JourneyFailureType
  recoveryClass: JourneyRecoveryClass
  message: string
  actions: JourneyRecoveryAction[]
  preserveState: boolean
  clearState: boolean
  shouldRetry: boolean
  shouldAlert: boolean
}

export const JOURNEY_RECOVERY_COPY = {
  savedProgressRetry: "We couldn't complete that step right now. Your progress is saved. Please try again.",
  addressSaveFailed: "We couldn't save that address. Please send the street address again, for example: 14 Main Street.",
  staleAction: "That option is no longer active. Let's continue from the latest step.",
  expiredSession: 'This session expired, but your saved progress may still be available. Continue where you left off?',
  mediaFailed: "We couldn't process that file. Please try another one or continue without it.",
  storageFailed: "We couldn't save that file right now. Please try again or continue without it.",
  matchingPending: "We haven't found suitable providers yet. We're still checking.",
  noProvidersFound: "We haven't found suitable providers yet. We're still checking.",
  requestNotFound: "We couldn't find that request. You can start a new request or return to the main menu.",
  applicationNotFound: "We couldn't find that provider application. You can apply again or contact support.",
  statusLoadFailed: "We couldn't load the latest status right now. Your request is still saved. Please try again.",
  resumeFlow: "You're still completing a journey. Let's continue from where you left off.",
  genericCrash: "We couldn't complete that step right now. Your progress is saved where possible. Please try again.",
  providerProfilePhotoFailed: "We couldn't upload that photo. Please try again or tap Skip to continue without one.",
  customerPhotoFailed: "We couldn't upload that photo. Please try again or type skip to continue without it.",
} as const

function defaultRecoveryClass(failureType: JourneyFailureType): JourneyRecoveryClass {
  // Validation and media/storage errors are usually recoverable at the same step.
  if (
    failureType === 'validation_error' ||
    failureType === 'missing_input' ||
    failureType === 'invalid_selection' ||
    failureType === 'storage_failure' ||
    failureType === 'media_processing_failure' ||
    failureType === 'database_failure'
  ) {
    return 'retry_same_step'
  }
  if (failureType === 'stale_action' || failureType === 'state_mismatch') return 'resume_step'
  if (failureType === 'expired_session') return 'resume_step'
  if (failureType === 'matching_failure' || failureType === 'no_results') return 'show_status'
  if (failureType === 'permission_denied' || failureType === 'rate_limited') return 'contact_support'
  return 'retry_same_step'
}

function actionsFor(recoveryClass: JourneyRecoveryClass, flowName: string): JourneyRecoveryAction[] {
  if (recoveryClass === 'resume_step') {
    return [
      { id: 'flow_continue', title: 'Continue' },
      { id: flowName === 'job_request' ? 'start_cancel' : 'cancel_flow', title: flowName === 'job_request' ? 'Cancel request' : 'Cancel' },
      { id: 'session_restart', title: 'Main menu' },
    ]
  }
  if (recoveryClass === 'show_status') {
    return [
      { id: 'status', title: ctaLabelFor('check_status') },
      { id: 'back_home', title: 'Main menu' },
    ]
  }
  if (recoveryClass === 'start_again') {
    return [
      { id: 'book', title: 'Start new request' },
      { id: 'back_home', title: 'Main menu' },
    ]
  }
  if (recoveryClass === 'contact_support') {
    return [
      { id: 'provider_support', title: 'Contact support' },
      { id: 'back_home', title: 'Main menu' },
    ]
  }
  return [
    { id: 'retry_step', title: 'Try again' },
    { id: 'back_home', title: 'Main menu' },
  ]
}

function messageFor(input: ResolveJourneyRecoveryInput, recoveryClass: JourneyRecoveryClass, traceId: string) {
  const flowName = String(input.flowName)
  const step = String(input.currentStep)

  if (input.failureType === 'stale_action' && recoveryClass !== 'resume_step') return JOURNEY_RECOVERY_COPY.staleAction
  if (input.failureType === 'expired_session') return JOURNEY_RECOVERY_COPY.expiredSession
  if (input.failureType === 'no_results') return JOURNEY_RECOVERY_COPY.noProvidersFound
  if (flowName === 'status') return JOURNEY_RECOVERY_COPY.statusLoadFailed
  if (step === 'collect_address_street' && input.failureType === 'database_failure') {
    return JOURNEY_RECOVERY_COPY.addressSaveFailed
  }
  if (step === 'collect_photos') return JOURNEY_RECOVERY_COPY.customerPhotoFailed
  if (step === 'reg_collect_profile_photo') return JOURNEY_RECOVERY_COPY.providerProfilePhotoFailed
  if (input.failureType === 'media_processing_failure') return JOURNEY_RECOVERY_COPY.mediaFailed
  if (input.failureType === 'storage_failure') return JOURNEY_RECOVERY_COPY.storageFailed

  if (recoveryClass === 'resume_step') {
    if (flowName === 'job_request' && step === 'collect_address_street') {
      return "You're still completing your service request. Let's continue from the street address step."
    }
    if (flowName === 'job_request') return "You're still completing your service request. Let's continue from the latest step."
    if (flowName === 'registration') return "You're still completing your provider application. Continue from where you left off?"
    return JOURNEY_RECOVERY_COPY.resumeFlow
  }

  return `${JOURNEY_RECOVERY_COPY.genericCrash}\n\nRef: ${traceId}`
}

export function resolveJourneyRecovery(input: ResolveJourneyRecoveryInput): JourneyRecoveryPlan {
  const traceId = input.traceId ?? createTraceId('pap')
  const recoveryClass = input.recoveryClass ?? defaultRecoveryClass(input.failureType)
  const preserveState = !['return_main_menu', 'start_again'].includes(recoveryClass)
  const clearState = recoveryClass === 'return_main_menu' || recoveryClass === 'start_again'
  const shouldRetry = recoveryClass === 'retry_same_step' || recoveryClass === 'resume_step' || recoveryClass === 'show_status'
  const shouldAlert =
    input.failureType === 'unexpected_error' ||
    input.failureType === 'database_failure' ||
    input.failureType === 'storage_failure' ||
    input.failureType === 'external_service_failure' ||
    input.failureType === 'state_mismatch'

  return {
    traceId,
    failureType: input.failureType,
    recoveryClass,
    message: messageFor(input, recoveryClass, traceId),
    actions: actionsFor(recoveryClass, String(input.flowName)),
    preserveState,
    clearState,
    shouldRetry,
    shouldAlert,
  }
}

export function logJourneyRecovery(input: ResolveJourneyRecoveryInput, plan: JourneyRecoveryPlan): void {
  // Privacy note: phone is masked; addresses, OTPs, media URLs and raw payloads
  // are intentionally excluded from the common journey-failure log.
  const event = plan.shouldAlert ? 'error' : 'warn'
  const payload = {
    traceId: plan.traceId,
    userRole: input.userRole,
    channel: input.channel,
    flowName: input.flowName,
    currentStep: input.currentStep,
    recoveryClass: plan.recoveryClass,
    failureType: plan.failureType,
    requestId: input.requestId ?? null,
    applicationId: input.applicationId ?? null,
    jobId: input.jobId ?? null,
    actionId: input.actionId ?? null,
    messageId: input.messageId ?? null,
    lastKnownState: input.lastKnownState ?? null,
    phone: input.phone ? maskPhone(input.phone) : null,
    statePreserved: plan.preserveState,
    stateCleared: plan.clearState,
    error: input.error ? safeErrorMessage(input.error) : null,
  }
  console[event]('[journey-recovery] user-facing recovery sent', payload)
}

export async function sendWhatsAppJourneyRecovery(
  phone: string,
  input: ResolveJourneyRecoveryInput,
): Promise<JourneyRecoveryPlan> {
  const plan = resolveJourneyRecovery({ ...input, channel: 'whatsapp', phone })
  logJourneyRecovery({ ...input, channel: 'whatsapp', phone }, plan)

  if (plan.actions.length > 0) {
    await sendButtons(
      phone,
      plan.message,
      plan.actions.slice(0, 3) as QuickReply[],
      undefined,
      {
        templateName: 'interactive:journey_recovery',
        metadata: {
          traceId: plan.traceId,
          flowName: input.flowName,
          step: input.currentStep,
          failureType: input.failureType,
          recoveryClass: plan.recoveryClass,
        },
      },
    )
    return plan
  }

  await sendText(phone, plan.message, {
    templateName: 'interactive:journey_recovery',
    metadata: {
      traceId: plan.traceId,
      flowName: input.flowName,
      step: input.currentStep,
      failureType: input.failureType,
      recoveryClass: plan.recoveryClass,
    },
  })
  return plan
}
