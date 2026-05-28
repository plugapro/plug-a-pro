// POST /api/provider-verifications
// Issues an internal Plug A Pro verification link for a provider, routed
// through the Didit adapter by default. Does NOT create the Didit session —
// the provider must accept consent first via the PWA flow.
//
// Admin-only (or system caller with admin credentials). Returns the INTERNAL
// verify-link URL, never the raw Didit URL.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApi } from '@/lib/auth'
import { issueDiditOnboardingLinkAction } from '@/app/(admin)/admin/verifications/actions'

const PostBodySchema = z.object({
  providerId: z.string().min(1),
  workflowProfile: z.enum(['KYC_BASIC', 'KYC_AUTHORITATIVE']).optional(),
})

export async function POST(request: Request) {
  const unauthorized = await requireAdminApi()
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = PostBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.flatten() }, { status: 400 })
  }

  const result = await issueDiditOnboardingLinkAction(parsed.data)
  if (!result.ok) {
    return NextResponse.json({ error: 'issue_failed' }, { status: 500 })
  }
  return NextResponse.json({
    verificationId: result.verificationId,
    verificationUrl: result.verificationUrl,
    expiresAt: result.expiresAt,
  }, { status: 201 })
}
