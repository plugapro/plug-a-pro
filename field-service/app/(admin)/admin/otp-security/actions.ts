'use server'

import type { SecurityEventStatus } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { crudAction } from '@/lib/crud-action'
import { clearLock } from '@/lib/otp-security'

const FLAG = 'admin.security.otp'
const TRUST_ROLES = ['TRUST', 'ADMIN', 'OWNER'] as const
const ADMIN_OTP_SECURITY_PATH = '/admin/otp-security'

const ReasonSchema = z.string().trim().max(500).optional()

const SecurityEventActionSchema = z.object({
  eventId: z.string().min(1),
  reason: ReasonSchema,
})

const ClearAccountLockSchema = z.object({
  phoneE164: z.string().trim().regex(/^\+\d{7,15}$/, 'Enter a valid E.164 phone number.'),
  reason: z.string().trim().min(1).max(500),
})

type SecurityEventActionInput = {
  eventId: string
  reason?: string
}

type ClearAccountLockInput = {
  phoneE164: string
  reason: string
}

type SecurityEventActionResult = {
  id: string
  status: SecurityEventStatus
  resolvedAt: Date | null
  resolvedByUserId: string | null
}

function adminActorId(admin: Awaited<ReturnType<typeof requireAdmin>>): string {
  return admin.adminUserId ?? admin.id
}

function normalizeReason(reason?: string): string | undefined {
  const trimmed = reason?.trim()
  return trimmed || undefined
}

async function updateSecurityEventStatus(
  input: SecurityEventActionInput,
  params: {
    action: string
    status: SecurityEventStatus
    terminal: boolean
  },
) {
  const admin = await requireAdmin()
  const actorId = adminActorId(admin)

  const result = await crudAction<SecurityEventActionInput, SecurityEventActionResult>({
    entity: 'SecurityEvent',
    entityId: input.eventId,
    action: params.action,
    requiredRole: [...TRUST_ROLES],
    requiredFlag: FLAG,
    schema: SecurityEventActionSchema,
    input,
    reason: normalizeReason(input.reason),
    run: async (data, tx) => {
      const now = new Date()
      const updated = await tx.securityEvent.update({
        where: { id: data.eventId },
        data: params.terminal
          ? {
              status: params.status,
              resolvedAt: now,
              resolvedByUserId: actorId,
            }
          : { status: params.status },
        select: {
          id: true,
          status: true,
          resolvedAt: true,
          resolvedByUserId: true,
        },
      })

      return updated
    },
  })

  revalidatePath(ADMIN_OTP_SECURITY_PATH)
  return result
}

export async function acknowledgeSecurityEventAction(input: SecurityEventActionInput) {
  return updateSecurityEventStatus(input, {
    action: 'security_event.acknowledge',
    status: 'ACKNOWLEDGED',
    terminal: false,
  })
}

export async function resolveSecurityEventAction(input: SecurityEventActionInput) {
  return updateSecurityEventStatus(input, {
    action: 'security_event.resolve',
    status: 'RESOLVED',
    terminal: true,
  })
}

export async function markFalsePositiveAction(input: SecurityEventActionInput) {
  return updateSecurityEventStatus(input, {
    action: 'security_event.mark_false_positive',
    status: 'FALSE_POSITIVE',
    terminal: true,
  })
}

export async function clearAccountLockAction(input: ClearAccountLockInput) {
  const admin = await requireAdmin()
  const actorId = adminActorId(admin)

  const result = await crudAction<ClearAccountLockInput, { phoneE164: string; cleared: true }>({
    entity: 'AccountSecurityState',
    entityId: input.phoneE164,
    action: 'security_account.clear_lock',
    requiredRole: [...TRUST_ROLES],
    requiredFlag: FLAG,
    schema: ClearAccountLockSchema,
    input,
    reason: input.reason.trim(),
    run: async (data) => {
      await clearLock(data.phoneE164, { byAdminId: actorId })
      return { phoneE164: data.phoneE164, cleared: true }
    },
  })

  revalidatePath(ADMIN_OTP_SECURITY_PATH)
  return result
}

function formText(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

export async function acknowledgeSecurityEventFormAction(formData: FormData) {
  await acknowledgeSecurityEventAction({
    eventId: formText(formData, 'eventId'),
    reason: formText(formData, 'reason') || undefined,
  })
}

export async function resolveSecurityEventFormAction(formData: FormData) {
  await resolveSecurityEventAction({
    eventId: formText(formData, 'eventId'),
    reason: formText(formData, 'reason') || undefined,
  })
}

export async function markFalsePositiveFormAction(formData: FormData) {
  await markFalsePositiveAction({
    eventId: formText(formData, 'eventId'),
    reason: formText(formData, 'reason') || undefined,
  })
}

export async function clearAccountLockFormAction(formData: FormData) {
  await clearAccountLockAction({
    phoneE164: formText(formData, 'phoneE164'),
    reason: formText(formData, 'reason'),
  })
}
