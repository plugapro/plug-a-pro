export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { getSession } from '@/lib/auth'
import { createTraceId, timestamp } from '@/lib/support-diagnostics'

export default async function LeadIdRedirectPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const { leadId } = await params
  const session = await getSession()

  if (session?.role === 'provider') {
    redirect(`/provider/leads/${leadId}`)
  }

  const traceId = createTraceId('job')
  console.warn('[leads/public] unsigned lead link opened without provider session', {
    traceId,
    leadId,
    action: 'View Job',
  })

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-lg items-center px-4">
          <p className="text-sm font-semibold">Plug A Pro</p>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-8">
        <div className="rounded-lg border bg-card px-4 py-5 space-y-3">
          <h1 className="text-lg font-semibold">This job link is missing secure access.</h1>
          <p className="text-sm text-muted-foreground">
            Please open the latest WhatsApp message and tap the signed View Job button. For privacy, customer job details are not available from an unsigned public link.
          </p>
          <dl className="space-y-1 rounded-md bg-muted/50 p-3 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Error code</dt>
              <dd className="text-right font-medium">JOB_LINK_INVALID</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Job ref</dt>
              <dd className="text-right font-medium">{leadId.slice(-8).toUpperCase()}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Action</dt>
              <dd className="text-right font-medium">View Job</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Time</dt>
              <dd className="text-right font-medium">{timestamp()}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Trace ID</dt>
              <dd className="text-right font-medium">{traceId}</dd>
            </div>
          </dl>
          <Button asChild className="w-full">
            <a href="/provider-sign-in">Open Worker Portal</a>
          </Button>
        </div>
      </main>
    </div>
  )
}
