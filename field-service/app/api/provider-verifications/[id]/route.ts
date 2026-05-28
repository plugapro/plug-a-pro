// GET /api/provider-verifications/[id]
// Returns a redacted view of a provider identity verification — internal
// status, decision, assurance level, vendor metadata. No raw vendor payload,
// no encrypted session URL, no `vendorReference` (Didit session id) — the
// session id is sensitive enough that we don't expose it to anything that
// isn't the admin Vendors page.

import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminApi()
  if (unauthorized) return unauthorized

  const { id } = await params
  const verification = await db.providerIdentityVerification.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      decision: true,
      assuranceLevel: true,
      sourceCheckProvider: true,
      vendorWorkflowId: true,
      livenessSessionExpiresAt: true,
      decisionAt: true,
      costEstimateCents: true,
      costCurrency: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!verification) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json(verification)
}
