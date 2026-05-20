'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { manualOverrideAssignment } from '@/lib/matching/service'
import { orchestrateMatch } from '@/lib/matching/orchestrator'
import { getCaseByEntity, addEvent } from '@/lib/cases'

const FLAG = 'admin.crud.dispatch'
const DISPATCH_ROLES = ['OPS', 'ADMIN', 'OWNER'] as const

// ─── Override Assignment ───────────────────────────────────────────────────────

const OverrideSchema = z.object({
  jobRequestId: z.string().min(1),
  providerId: z.string().min(1),
  reasonCode: z.string().default('FORCE_ASSIGNED_COVERAGE_EXTENSION'),
})

export async function overrideAssignmentAction(formData: FormData) {
  const jobRequestId = String(formData.get('jobRequestId') ?? '')
  const providerId = String(formData.get('providerId') ?? '')
  const reasonCode = String(formData.get('reasonCode') || 'FORCE_ASSIGNED_COVERAGE_EXTENSION')

  try {
    await crudAction({
      entity: 'JobRequest',
      action: 'dispatch.override_assignment',
      requiredRole: [...DISPATCH_ROLES],
      requiredFlag: FLAG,
      schema: OverrideSchema,
      input: { jobRequestId, providerId, reasonCode },
      run: async ({ jobRequestId: jrId, providerId: pid, reasonCode: rc }, _tx) => {
        const activeAdmin = await requireAdmin()
        await manualOverrideAssignment({
          jobRequestId: jrId,
          providerId: pid,
          actor: { actorId: activeAdmin.id, actorRole: 'admin' },
          overrideReason: rc,
        })
        // Non-blocking case event - do not let a case-write failure block the override
        getCaseByEntity('DISPATCH', 'JOB_REQUEST', jrId)
          .then((dispCase) => {
            if (dispCase == null) return
            return addEvent({
              caseId: dispCase.id,
              type: 'OPS_ACTION',
              payload: { action: 'force_assign', providerId: pid, reasonCode: rc },
              actorUserId: activeAdmin.id,
            })
          })
          .catch(() => {})
        return { id: jrId, providerId: pid }
      },
    })

    revalidatePath('/admin/dispatch')
    revalidatePath('/admin')
    redirect(`/admin/dispatch?request=${jobRequestId}&message=override_assigned`)
  } catch (error) {
    if (error instanceof CrudActionError) {
      redirect(`/admin/dispatch?request=${jobRequestId}&message=dispatch_override_failed`)
    }
    // redirect() throws - re-throw so Next.js can handle it
    throw error
  }
}

// ─── Re-dispatch (retry leads) ────────────────────────────────────────────────

export async function redispatchFromFormAction(formData: FormData) {
  const activeAdmin = await requireAdmin()
  const jobRequestId = String(formData.get('jobRequestId') ?? '')

  if (!jobRequestId) return

  try {
    await orchestrateMatch(jobRequestId, { triggeredBy: 'manual' })

    // Non-blocking case event
    getCaseByEntity('DISPATCH', 'JOB_REQUEST', jobRequestId)
      .then((dispCase) => {
        if (dispCase == null) return
        return addEvent({
          caseId: dispCase.id,
          type: 'OPS_ACTION',
          payload: { action: 'redispatch_triggered', triggeredBy: activeAdmin.id },
          actorUserId: activeAdmin.id,
        })
      })
      .catch(() => {})

    revalidatePath('/admin/dispatch')
    redirect(`/admin/dispatch?request=${jobRequestId}&message=redispatch_triggered`)
  } catch (error) {
    // redirect() throws - re-throw so Next.js can handle it
    if (
      typeof error === 'object' &&
      error !== null &&
      'digest' in error &&
      typeof (error as { digest?: string }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw error
    }
    console.error('[dispatch/actions] Redispatch failed', { jobRequestId, error })
    redirect(`/admin/dispatch?request=${jobRequestId}&message=redispatch_failed`)
  }
}

// ─── Escalate to Supply ───────────────────────────────────────────────────────

export async function escalateToSupplyFromFormAction(formData: FormData) {
  const activeAdmin = await requireAdmin()
  const jobRequestId = String(formData.get('jobRequestId') ?? '')
  const reason = String(
    formData.get('reason') || 'No providers available - needs supply expansion',
  )

  if (!jobRequestId) return

  try {
    const dispCase = await getCaseByEntity('DISPATCH', 'JOB_REQUEST', jobRequestId).catch(
      () => null,
    )

    if (dispCase) {
      await addEvent({
        caseId: dispCase.id,
        type: 'ESCALATION',
        payload: { reason, escalatedTo: 'SUPPLY', escalatedBy: activeAdmin.id },
        actorUserId: activeAdmin.id,
      })
    }

    revalidatePath('/admin/dispatch')
    redirect(`/admin/dispatch?request=${jobRequestId}&message=escalation_recorded`)
  } catch (error) {
    // redirect() throws - re-throw so Next.js can handle it
    if (
      typeof error === 'object' &&
      error !== null &&
      'digest' in error &&
      typeof (error as { digest?: string }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw error
    }
    console.error('[dispatch/actions] Escalation failed', { jobRequestId, error })
    redirect(`/admin/dispatch?request=${jobRequestId}&message=escalation_failed`)
  }
}
