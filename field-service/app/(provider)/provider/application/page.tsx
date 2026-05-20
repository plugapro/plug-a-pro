// ─── Provider: Application status ─────────────────────────────────────────────
// Read-only view of the provider's most recent ProviderApplication row.
// Supports WhatsApp handoff events: start_application, continue_application,
// more_info_required, application_approved.
// PWA is optional - WhatsApp is the primary application channel.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { FileText } from 'lucide-react'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { AlertCallout } from '@/components/shared/AlertCallout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const metadata = buildMetadata({ title: 'Application status', noIndex: true })

function statusVariant(status: string): 'neutral' | 'info' | 'warning' | 'success' | 'destructive' {
  switch (status) {
    case 'APPROVED': return 'success'
    case 'PENDING': return 'info'
    case 'MORE_INFO_REQUIRED': return 'warning'
    case 'REJECTED': return 'destructive'
    default: return 'neutral'
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'APPROVED': return 'Approved'
    case 'PENDING': return 'Under review'
    case 'MORE_INFO_REQUIRED': return 'More info required'
    case 'REJECTED': return 'Not approved'
    default: return status
  }
}

export default async function ProviderApplicationPage() {
  const session = await requireProvider()

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true, phone: true, name: true, verified: true, status: true },
  })

  if (!provider) {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<FileText className="size-5" />}
          title="Provider account not found"
          description="Your provider account is not yet set up. Contact support to continue."
        />
      </div>
    )
  }

  const application = await db.providerApplication.findFirst({
    where: { providerId: provider.id },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      status: true,
      notes: true,
      submittedAt: true,
      reviewedAt: true,
      name: true,
      skills: true,
      serviceAreas: true,
      experience: true,
    },
  })

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <PageHeader
        eyebrow="Application"
        title="Application status"
        description="Your provider application and marketplace eligibility."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/provider">Dashboard</Link>
          </Button>
        }
      />

      {/* Provider account status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Marketplace status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {provider.name ?? 'Your account'}
            </p>
            <Badge variant={provider.verified ? 'success' : 'warning'}>
              {provider.verified ? 'Approved' : 'Pending approval'}
            </Badge>
          </div>
          {provider.verified ? (
            <AlertCallout tone="success" title="You are approved">
              You are eligible to receive job leads and accept customer-selected jobs.
            </AlertCallout>
          ) : (
            <AlertCallout tone="brand" title="Approval in progress">
              We review all new providers before activating your account. We will WhatsApp you once approved - this usually takes up to 30 minutes for new applications.
            </AlertCallout>
          )}
        </CardContent>
      </Card>

      {/* Application record */}
      {application ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Application details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={statusVariant(application.status)}>
                {statusLabel(application.status)}
              </Badge>
            </div>

            {application.submittedAt ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Submitted</span>
                <span>
                  {application.submittedAt.toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
            ) : null}

            {application.reviewedAt ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Reviewed</span>
                <span>
                  {application.reviewedAt.toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
            ) : null}

            {application.skills.length > 0 ? (
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">Skills submitted</span>
                <span className="text-right">{application.skills.join(', ')}</span>
              </div>
            ) : null}

            {application.serviceAreas.length > 0 ? (
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">Areas submitted</span>
                <span className="text-right">{application.serviceAreas.join(', ')}</span>
              </div>
            ) : null}

            {application.notes ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Admin note
                </p>
                <p>{application.notes}</p>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Ref: {application.id.slice(-8).toUpperCase()}
            </p>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="No application on record"
          description="Applications are submitted via WhatsApp. If you have already applied, we may still be linking your account."
        />
      )}

      <p className="text-center text-xs text-muted-foreground">
        Questions? Reply to any of our WhatsApp messages or contact support.
      </p>
    </div>
  )
}
