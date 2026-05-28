// POST /api/provider-verifications/[id]/refresh
// Server-side poll: re-fetches the Didit decision and applies the verdict
// via the orchestrator. Admin (TRUST+) only — for missed-webhook recovery.

import { NextResponse } from 'next/server'
import { requireRoleApi } from '@/lib/auth'
import { refreshDiditSessionAction } from '@/app/(admin)/admin/verifications/actions'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRoleApi(['TRUST', 'ADMIN', 'OWNER'])
  if (guard instanceof Response) return guard

  const { id } = await params
  const result = await refreshDiditSessionAction({ verificationId: id })
  if (!result.ok) {
    return NextResponse.json({ error: 'refresh_failed' }, { status: 500 })
  }
  return NextResponse.json({ status: result.status, decision: result.decision })
}
