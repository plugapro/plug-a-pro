import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { recordAuditLog } from '@/lib/audit'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { sendFreshAcceptedJobLink } from '@/lib/accepted-job-actions'
import {
  hashSignedToken,
  providerLeadTokenAllowsScope,
  resolveProviderLeadAccessToken,
  verifyProviderLeadAccessToken,
} from '@/lib/provider-lead-access'
import { resolveProviderPwaHandoffPath } from '@/lib/provider-pwa-handoff'
import { createTraceId, type DiagnosticCode } from '@/lib/support-diagnostics'

export const dynamic = 'force-dynamic'

async function requestFreshProviderJobLink(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const jobId = String(formData.get('jobId') ?? '')
  await sendFreshAcceptedJobLink({ token }).catch(() => null)
  redirect(`/provider/jobs/${encodeURIComponent(jobId)}/handover?token=${encodeURIComponent(token)}&fresh=sent`)
}

function LinkErrorCard({
  title,
  code,
  jobRef,
  traceId,
  token,
  jobId,
  children,
}: {
  title: string
  code: DiagnosticCode
  jobRef?: string | null
  traceId: string
  token?: string
  jobId: string
  children?: ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4 py-8">
      <div className="w-full rounded-lg border bg-card p-5 text-sm shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Secure WhatsApp job link</p>
        <h1 className="mt-2 text-xl font-semibold">{title}</h1>
        <p className="mt-3 text-muted-foreground">
          Request a new link from WhatsApp.
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Error code</dt>
          <dd className="text-right font-medium">{code}</dd>
          {jobRef ? (
            <>
              <dt className="text-muted-foreground">Job ref</dt>
              <dd className="text-right font-medium">{jobRef}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Trace ID</dt>
          <dd className="text-right font-medium">{traceId}</dd>
        </dl>
        {children}
        {token ? (
          <form action={requestFreshProviderJobLink} className="mt-4">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="jobId" value={jobId} />
            <Button type="submit" className="w-full">Send me a new link</Button>
          </form>
        ) : null}
      </div>
    </main>
  )
}

export default async function ProviderJobHandoverEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>
  searchParams?: Promise<{ token?: string; fresh?: string }>
}) {
  const { jobId } = await params
  const resolvedSearch = searchParams ? await searchParams : {}
  const token = resolvedSearch.token ?? ''
  const traceId = createTraceId('job')
  const verified = verifyProviderLeadAccessToken(token)
  const jobRef = (verified.payload?.jobRequestId ?? jobId).slice(-8).toUpperCase()

  if (verified.status === 'expired') {
    console.warn('[provider/jobs/handover] signed link expired', {
      trace_id: traceId,
      token_hash: hashSignedToken(token),
      job_id: verified.payload?.jobRequestId ?? jobId,
      lead_id: verified.payload?.leadId,
      provider_id: verified.payload?.providerId,
      channel: 'whatsapp_signed_link',
    })
    return (
      <LinkErrorCard
        title="This job link has expired."
        code="JOB_LINK_EXPIRED"
        jobRef={jobRef}
        traceId={traceId}
        token={token}
        jobId={jobId}
      >
        {resolvedSearch.fresh === 'sent' ? (
          <p className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
            We sent a fresh secure link to the accepted provider WhatsApp number.
          </p>
        ) : null}
      </LinkErrorCard>
    )
  }

  if (
    verified.status !== 'active' ||
    !providerLeadTokenAllowsScope(verified.payload, 'view_job')
  ) {
    console.warn('[provider/jobs/handover] signed link invalid', {
      trace_id: traceId,
      token_hash: token ? hashSignedToken(token) : null,
      job_id: verified.payload?.jobRequestId ?? jobId,
      lead_id: verified.payload?.leadId,
      provider_id: verified.payload?.providerId,
      channel: 'whatsapp_signed_link',
      reason: verified.status === 'active' ? 'scope_denied' : verified.status,
    })
    return (
      <LinkErrorCard
        title="This job link is invalid."
        code="JOB_LINK_INVALID"
        jobRef={jobRef}
        traceId={traceId}
        jobId={jobId}
      />
    )
  }

  const resolved = await resolveProviderLeadAccessToken(token)
  const lead = resolved.lead
  const matchesJob =
    lead &&
    (lead.jobRequestId === jobId || lead.id === jobId || verified.payload?.jobRequestId === jobId)

  if (resolved.status !== 'active' || !lead || !matchesJob) {
    console.warn('[provider/jobs/handover] signed link rejected after resolve', {
      trace_id: traceId,
      token_hash: hashSignedToken(token),
      job_id: jobId,
      payload_job_request_id: verified.payload?.jobRequestId,
      lead_id: verified.payload?.leadId,
      provider_id: verified.payload?.providerId,
      channel: 'whatsapp_signed_link',
      reason: resolved.status,
    })
    return (
      <LinkErrorCard
        title="This job link is invalid."
        code="JOB_LINK_INVALID"
        jobRef={jobRef}
        traceId={traceId}
        jobId={jobId}
      />
    )
  }

  await recordAuditLog({
    actorId: lead.providerId,
    actorRole: 'provider',
    action: 'signed_link.view_job',
    entityType: AUDIT_ENTITY.JOB_REQUEST,
    entityId: lead.jobRequestId,
    after: {
      tokenHash: hashSignedToken(token),
      leadId: lead.id,
      providerId: lead.providerId,
      customerId: lead.jobRequest.customer?.id ?? null,
      channel: 'whatsapp_signed_link',
      traceId,
    },
  }).catch(() => {})

  console.info('[provider/jobs/handover] signed link accepted', {
    trace_id: traceId,
    token_hash: hashSignedToken(token),
    job_id: lead.jobRequestId,
    lead_id: lead.id,
    provider_id: lead.providerId,
    customer_id: lead.jobRequest.customer?.id ?? null,
    action: 'view_job',
    channel: 'whatsapp_signed_link',
    timestamp: new Date().toISOString(),
  })

  redirect(resolveProviderPwaHandoffPath({
    event: 'job_accepted',
    token,
    lead,
  }))
}
