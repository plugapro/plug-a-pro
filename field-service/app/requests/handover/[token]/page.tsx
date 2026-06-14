export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'
import { resolveCustomerProviderHandoverToken } from '@/lib/customer-provider-handover-access'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'
import { ProviderTrustNote } from '@/components/shared/provider-trust-note'
import { ProviderTrustSignals } from '@/components/shared/provider-trust-signals'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildProviderTrustSignals } from '@/lib/provider-trust'
import { normaliseLocationDisplayName } from '@/lib/location-format'

export const metadata = buildMetadata({ title: 'Provider Handover', noIndex: true })

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'there'
}

function formatArea(address: { suburb: string | null; city: string | null; province: string | null } | null) {
  return [
    normaliseLocationDisplayName(address?.suburb),
    normaliseLocationDisplayName(address?.city),
    normaliseLocationDisplayName(address?.province),
  ].filter(Boolean).join(', ') || 'Location on ticket'
}

function whatsappHref(phone: string, customerName: string, category: string) {
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Hi, this is ${firstName(customerName)} from Plug A Pro about my ${category} request.`)}`
}

export default async function CustomerProviderHandoverPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const result = await resolveCustomerProviderHandoverToken(token)

  if (result.status !== 'active' || !result.handover) {
    const expired = result.status === 'expired'
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <Card>
          <CardContent className="space-y-3 px-4 py-5 text-sm">
            <p className="font-medium">{expired ? 'This provider link has expired' : 'This provider link is no longer available'}</p>
            <p className="text-muted-foreground">
              For your privacy, provider handover links only open the accepted provider for one request and stop working if the job is cancelled or reassigned.
            </p>
            <Button asChild className="w-full">
              <Link href="/sign-in">Sign in to view your tickets</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { jobRequest, match } = result.handover
  const provider = match.provider
  const providerSignals = buildProviderTrustSignals({
    marketplaceApproved: provider.verified,
    skills: provider.skills,
    serviceAreas: provider.serviceAreas,
    experience: provider.experience,
    evidenceNote: provider.evidenceNote,
  })
  const ref = jobRequest.id.slice(-8).toUpperCase()
  const providerContactHref = whatsappHref(provider.phone, jobRequest.customer.name, jobRequest.category)

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-6 pb-10">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Plug A Pro handover
        </p>
        <h1 className="text-xl font-semibold">Provider accepted your request</h1>
        <p className="text-sm text-muted-foreground">
          Ref: {ref} · {jobRequest.category}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Accepted provider
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-start gap-3">
            {provider.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={provider.avatarUrl}
                alt=""
                className="h-14 w-14 rounded-full border object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full border bg-muted text-lg font-semibold">
                {provider.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{provider.name}</p>
              <p className="text-muted-foreground">{provider.phone}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Accepted {match.createdAt.toLocaleString('en-ZA', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <StatusBadge status={match.status} type="match" />
          </div>

          {provider.bio && <p className="text-muted-foreground">{provider.bio}</p>}
          <ProviderTrustSignals signals={providerSignals} />
          <ProviderTrustNote marketplaceApproved={provider.verified} />

          <Button asChild className="w-full">
            <a href={providerContactHref} target="_blank" rel="noopener noreferrer">
              Contact Provider
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Next step
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">{provider.name} will contact you shortly to confirm the visit details.</p>
          <p className="text-muted-foreground">
            You can also message the provider directly using the phone number above. This handover is linked to your Plug A Pro ticket.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Request summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Status">
            <StatusBadge status={jobRequest.status} type="jobRequest" />
          </Row>
          <Row label="Service">{jobRequest.category}</Row>
          <Row label="Area">{formatArea(jobRequest.address)}</Row>
          <div>
            <p className="font-medium">{jobRequest.title}</p>
            <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{jobRequest.description}</p>
          </div>
          {jobRequest.attachments.filter((a) => a.safeForPreview !== false).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Uploaded photos
              </p>
              <div className="grid grid-cols-2 gap-2">
                {jobRequest.attachments.filter((a) => a.safeForPreview !== false).map((photo) => {
                  // Use the scoped handover token — never the customer bearer token
                  const src = `/api/attachments/${photo.id}?handoverToken=${encodeURIComponent(token)}`
                  return (
                    <AttachmentThumbnail
                      key={photo.id}
                      attachmentId={photo.id}
                      src={src}
                      alt={photo.caption ?? 'Request photo'}
                      fallbackText="Photo unavailable"
                      showDiagnostics={false}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  )
}
