import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { getRequiredDocumentKinds, type IdentityBasis } from '@/lib/identity-verification/types'
import { ProviderVerificationTokenError, resolveProviderVerificationToken } from '@/lib/provider-verification-token'
import {
  acceptIdentityConsent,
  submitIdentityBasisAndIdentifier,
  submitIdentityDocuments,
  submitIdentitySelfie,
  submitIdentityVerificationForReview,
} from './actions'

export const dynamic = 'force-dynamic'
export const metadata = buildMetadata({ title: 'Verify Identity', noIndex: true })

const BASIS_OPTIONS: Array<{ value: IdentityBasis; label: string }> = [
  { value: 'SA_ID', label: 'South African ID' },
  { value: 'PASSPORT', label: 'Passport / foreign national' },
  { value: 'REFUGEE_ID', label: 'Refugee ID' },
  { value: 'ASYLUM_PERMIT', label: 'Asylum seeker permit' },
  { value: 'REFUGEE_PERMIT', label: 'Refugee permit' },
  { value: 'WORK_PERMIT', label: 'Work permit' },
  { value: 'PERMANENT_RESIDENCE_PERMIT', label: 'Permanent residence permit' },
]

export default async function ProviderIdentityVerifyPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const verification = await resolveForPage(token)
  if (!verification) return <ExpiredLink />

  const documents = await db.providerIdentityDocument.findMany({
    where: { verificationId: verification.id, deletedAt: null },
    select: { id: true, documentKind: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const uploadedKinds = new Set(documents.map((doc) => doc.documentKind))
  const requiredKinds = getRequiredDocumentKinds(verification.identityBasis as IdentityBasis)

  async function acceptConsentAction() {
    'use server'
    await acceptIdentityConsent(token)
    redirect(`/provider/verify/${token}`)
  }

  async function identifierAction(formData: FormData) {
    'use server'
    await submitIdentityBasisAndIdentifier(token, {
      identityBasis: formData.get('identityBasis')?.toString() as IdentityBasis,
      identifier: formData.get('identifier')?.toString() ?? '',
      issuingCountry: formData.get('issuingCountry')?.toString() ?? undefined,
      nationality: formData.get('nationality')?.toString() ?? undefined,
      documentExpiryDate: formData.get('documentExpiryDate')?.toString() ?? undefined,
    })
    redirect(`/provider/verify/${token}`)
  }

  async function documentsDoneAction() {
    'use server'
    await submitIdentityDocuments(token)
    redirect(`/provider/verify/${token}`)
  }

  async function selfieDoneAction() {
    'use server'
    await submitIdentitySelfie(token)
    redirect(`/provider/verify/${token}`)
  }

  async function submitReviewAction() {
    'use server'
    await submitIdentityVerificationForReview(token)
    redirect(`/provider/verify/${token}`)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-4 py-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plug A Pro verification</p>
        <h1 className="text-2xl font-semibold tracking-normal">Confirm your identity</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Use this secure page for ID, passport, permit, document, and selfie uploads. Do not send those details in a
          WhatsApp message unless support tells you to use the low-data fallback.
        </p>
      </header>

      <StatusStrip status={verification.status} />

      {verification.status === 'NOT_STARTED' || verification.status === 'STARTED' ? (
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <h2 className="text-base font-semibold">Consent</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Plug A Pro will use your identity details only to verify your provider account, manage trust reviews, and
              meet legal or platform safety obligations.
            </p>
          </div>
          <form action={acceptConsentAction}>
            <button className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              I consent and want to continue
            </button>
          </form>
        </section>
      ) : null}

      {['CONSENTED', 'AWAITING_IDENTIFIER', 'RETRY_REQUIRED'].includes(verification.status) ? (
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <h2 className="text-base font-semibold">Identity details</h2>
            <p className="mt-1 text-sm text-muted-foreground">Your full number is not shown back after submission.</p>
          </div>
          <form action={identifierAction} className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Identity type</span>
              <select name="identityBasis" defaultValue={verification.identityBasis} className="h-11 rounded-md border bg-background px-3">
                {BASIS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">ID, passport, or permit number</span>
              <input name="identifier" required className="h-11 rounded-md border bg-background px-3" autoComplete="off" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <input name="issuingCountry" placeholder="Issuing country" className="h-11 rounded-md border bg-background px-3 text-sm" />
              <input name="nationality" placeholder="Nationality" className="h-11 rounded-md border bg-background px-3 text-sm" />
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Document expiry date, if applicable</span>
              <input name="documentExpiryDate" type="date" className="h-11 rounded-md border bg-background px-3" />
            </label>
            <button className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Save identity details
            </button>
          </form>
        </section>
      ) : null}

      {['AWAITING_DOCUMENT', 'AWAITING_SELFIE'].includes(verification.status) ? (
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <h2 className="text-base font-semibold">Required files</h2>
            <p className="mt-1 text-sm text-muted-foreground">Upload clear photos or PDFs. Each file is stored privately.</p>
          </div>
          <div className="space-y-3">
            {requiredKinds.map((kind) => (
              <form key={kind} action="/api/provider/identity/upload" method="post" encType="multipart/form-data" className="grid gap-2 rounded-md border p-3">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="verificationId" value={verification.id} />
                <input type="hidden" name="documentKind" value={kind} />
                <input type="hidden" name="returnTo" value={`/provider/verify/${token}`} />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{formatKind(kind)}</span>
                  <span className="text-xs text-muted-foreground">{uploadedKinds.has(kind) ? 'uploaded' : 'needed'}</span>
                </div>
                <input name="file" type="file" required accept="image/*,application/pdf" className="text-sm" />
                <button className="min-h-10 rounded-md border px-3 py-2 text-sm font-medium">Upload {formatKind(kind)}</button>
              </form>
            ))}
          </div>
          {verification.status === 'AWAITING_DOCUMENT' ? (
            <form action={documentsDoneAction}>
              <button className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Continue to selfie
              </button>
            </form>
          ) : (
            <form action={selfieDoneAction}>
              <button className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Confirm selfie upload
              </button>
            </form>
          )}
        </section>
      ) : null}

      {verification.status === 'SUBMITTED' ? (
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <h2 className="text-base font-semibold">Submit for review</h2>
          <p className="text-sm leading-6 text-muted-foreground">Our trust team will review the submitted files.</p>
          <form action={submitReviewAction}>
            <button className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Submit verification
            </button>
          </form>
        </section>
      ) : null}

      {['NEEDS_MANUAL_REVIEW', 'PASSED', 'FAILED'].includes(verification.status) ? (
        <section className="rounded-lg border bg-card p-4 text-sm leading-6">
          <h2 className="text-base font-semibold">{terminalTitle(verification.status)}</h2>
          <p className="mt-1 text-muted-foreground">{terminalCopy(verification.status)}</p>
          <Link href="/provider/verification" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
            Verification help
          </Link>
        </section>
      ) : null}
    </main>
  )
}

async function resolveForPage(token: string) {
  try {
    return await resolveProviderVerificationToken(token)
  } catch (error) {
    if (error instanceof ProviderVerificationTokenError) return null
    throw error
  }
}

function ExpiredLink() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plug A Pro verification</p>
      <h1 className="text-2xl font-semibold tracking-normal">Verification link unavailable</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        This secure link is invalid, expired, or already complete. Return to WhatsApp and request a new verification
        link.
      </p>
      <Link href="/provider/verification" className="text-sm font-medium underline underline-offset-4">
        Open verification help
      </Link>
    </main>
  )
}

function StatusStrip({ status }: { status: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <span className="text-muted-foreground">Status: </span>
      <span className="font-mono text-xs">{status.replaceAll('_', ' ').toLowerCase()}</span>
    </div>
  )
}

function formatKind(kind: string) {
  return kind.replaceAll('_', ' ').toLowerCase()
}

function terminalTitle(status: string) {
  if (status === 'PASSED') return 'Verification complete'
  if (status === 'FAILED') return 'Verification could not be approved'
  return 'Submitted for manual review'
}

function terminalCopy(status: string) {
  if (status === 'PASSED') return 'Your identity verification is complete.'
  if (status === 'FAILED') return 'Please contact Plug A Pro support for the next step.'
  return 'We will update you once the review is complete.'
}
