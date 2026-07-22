// Provider lead board: express-interest server action. Thin wrapper around
// lib/board/interest.ts's production wiring - all business rules (flag,
// eligibility, cap, revive-vs-create, compensating rollback) live there.
// Spec: docs/superpowers/specs/2026-07-21-provider-lead-board-design.md §1.
'use server'

import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { expressBoardInterestProduction, type BoardInterestResult } from '@/lib/board/interest'
import { revalidatePath } from 'next/cache'

export async function expressInterestAction(formData: FormData): Promise<BoardInterestResult> {
  const session = await requireProvider()
  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true },
  })
  if (!provider) {
    return { ok: false, reason: 'NOT_ELIGIBLE_PROVIDER' }
  }

  const jobRequestId = String(formData.get('jobRequestId') ?? '')
  const callOutFee = Number(formData.get('callOutFee'))
  const estimatedArrivalAt = new Date(String(formData.get('estimatedArrivalAt') ?? ''))
  const note = String(formData.get('note') ?? '') || undefined

  if (
    !jobRequestId ||
    !Number.isFinite(callOutFee) ||
    callOutFee < 0 ||
    Number.isNaN(estimatedArrivalAt.getTime())
  ) {
    return { ok: false, reason: 'INVALID_INPUT' }
  }

  const result = await expressBoardInterestProduction({
    providerId: provider.id,
    jobRequestId,
    callOutFee,
    estimatedArrivalAt,
    note,
  })

  revalidatePath('/provider/board')
  return result
}
