'use server'

import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  ONBOARDING_RECOVERY_STAGE_LABELS,
  recordOnboardingRecoveryAudit,
  type OnboardingRecoveryStage,
} from '@/lib/provider-onboarding-recovery'

type CopyLogInput = {
  stage: string
  phoneTail: string
  maskedPhone: string
  conversationId?: string | null
  applicationId?: string | null
}

function recoveryStageFrom(value: string): OnboardingRecoveryStage {
  return Object.prototype.hasOwnProperty.call(ONBOARDING_RECOVERY_STAGE_LABELS, value)
    ? value as OnboardingRecoveryStage
    : 'unknown'
}

export async function logRecoveryMessageCopiedAction(input: CopyLogInput) {
  const admin = await requireAdmin()
  const stage = recoveryStageFrom(input.stage)

  await recordOnboardingRecoveryAudit(db, {
    actionType: 'manual_follow_up_copied',
    stage,
    result: 'copied',
    phoneMasked: input.maskedPhone,
    phoneTail: input.phoneTail,
    entityId: input.conversationId ?? input.applicationId ?? `phone-tail:${input.phoneTail}`,
    actorId: admin.id,
    actorRole: admin.adminRole,
    messageTemplateKey: stage === 'unknown' ? null : stage,
    metadata: {
      source: 'admin_onboarding_recovery_dashboard',
      applicationId: input.applicationId ?? null,
    },
  })
}
