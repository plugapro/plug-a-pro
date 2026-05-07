// ─── Provider: /provider/jobs/[jobId]/complete alias ──────────────────────────
// Blueprint route /provider/jobs/:jobId/complete maps to the existing handover
// page which handles job completion state and quick-update actions.
// Preserves the signed token so the handover page can verify access.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function ProviderJobCompleteEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>
  searchParams?: Promise<{ token?: string }>
}) {
  const { jobId } = await params
  const token = (searchParams ? await searchParams : {}).token ?? ''
  redirect(`/provider/jobs/${encodeURIComponent(jobId)}/handover?token=${encodeURIComponent(token)}`)
}
