import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  resolveCustomerProviderHandoverToken,
  verifyCustomerProviderHandoverToken,
} from '@/lib/customer-provider-handover-access'
import { createTraceId } from '@/lib/support-diagnostics'

export const dynamic = 'force-dynamic'

function CustomerLinkErrorCard({
  title,
  code,
  requestRef,
  traceId,
}: {
  title: string
  code: 'JOB_LINK_INVALID' | 'JOB_LINK_EXPIRED'
  requestRef: string
  traceId: string
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4 py-8">
      <div className="w-full rounded-lg border bg-card p-5 text-sm shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plug A Pro handover</p>
        <h1 className="mt-2 text-xl font-semibold">{title}</h1>
        <p className="mt-3 text-muted-foreground">
          Please use the latest WhatsApp message for this request.
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Error code</dt>
          <dd className="text-right font-medium">{code}</dd>
          <dt className="text-muted-foreground">Ref</dt>
          <dd className="text-right font-medium">{requestRef}</dd>
          <dt className="text-muted-foreground">Trace ID</dt>
          <dd className="text-right font-medium">{traceId}</dd>
        </dl>
        <Button asChild className="mt-4 w-full">
          <Link href="/">Open Plug A Pro</Link>
        </Button>
      </div>
    </main>
  )
}

export default async function CustomerProviderHandoverEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>
  searchParams?: Promise<{ token?: string }>
}) {
  const { requestId } = await params
  const token = (searchParams ? await searchParams : {}).token ?? ''
  const traceId = createTraceId('handover')
  const verified = verifyCustomerProviderHandoverToken(token)
  const requestRef = (verified.payload?.jobRequestId ?? requestId).slice(-8).toUpperCase()

  if (verified.status === 'expired') {
    return (
      <CustomerLinkErrorCard
        title="This provider handover link has expired."
        code="JOB_LINK_EXPIRED"
        requestRef={requestRef}
        traceId={traceId}
      />
    )
  }

  const resolved = await resolveCustomerProviderHandoverToken(token)
  if (
    verified.status !== 'active' ||
    resolved.status !== 'active' ||
    !resolved.handover ||
    resolved.handover.jobRequest.id !== requestId
  ) {
    return (
      <CustomerLinkErrorCard
        title="This provider handover link is invalid."
        code="JOB_LINK_INVALID"
        requestRef={requestRef}
        traceId={traceId}
      />
    )
  }

  redirect(`/requests/handover/${encodeURIComponent(token)}`)
}
