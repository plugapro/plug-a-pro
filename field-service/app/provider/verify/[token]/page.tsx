import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { buildMetadata, siteConfig } from '@/lib/metadata'
import { renderIdentityConsentText } from '@/lib/identity-verification/consent-service'
import { resolveIdentityVerificationConsentVendor } from '@/lib/identity-verification/orchestrator'
import { getRequiredDocumentKinds, isIdentityBasis, type IdentityBasis } from '@/lib/identity-verification/types'
import { resolveProviderVerificationToken } from '@/lib/provider-verification-token'
import {
  acceptIdentityConsent,
  startHostedVerificationFromConsent,
  submitIdentityBasisAndIdentifier,
  submitIdentityDocuments,
  submitIdentitySelfie,
  submitIdentityVerificationForReview,
} from './actions'
import {
  documentStepRedirect,
  identifierStepRedirect,
  mapVerificationActionError,
  reviewStepRedirect,
  selfieStepRedirect,
} from './step-redirects'
import { IdentityDetailsForm } from './IdentityDetailsForm'

export const dynamic = 'force-dynamic'
export const metadata = buildMetadata({ title: 'Verify Identity', noIndex: true })

// Southern Africa first, then rest of Africa, then world - alphabetical within each group.
const COUNTRY_OPTIONS = [
  // Southern Africa
  'South Africa',
  'Botswana',
  'Eswatini',
  'Lesotho',
  'Mozambique',
  'Namibia',
  'Zimbabwe',
  // Rest of Africa
  'Angola',
  'Cameroon',
  'Democratic Republic of the Congo',
  'Egypt',
  'Ethiopia',
  'Ghana',
  'Kenya',
  'Malawi',
  'Nigeria',
  'Rwanda',
  'Senegal',
  'Somalia',
  'Sudan',
  'Tanzania',
  'Uganda',
  'Zambia',
  // Rest of world
  'Afghanistan',
  'Albania',
  'Algeria',
  'Argentina',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bangladesh',
  'Belgium',
  'Bolivia',
  'Brazil',
  'Bulgaria',
  'Cambodia',
  'Canada',
  'Chile',
  'China',
  'Colombia',
  'Croatia',
  'Cuba',
  'Czech Republic',
  'Denmark',
  'Ecuador',
  'Finland',
  'France',
  'Germany',
  'Greece',
  'Guatemala',
  'Honduras',
  'Hungary',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Libya',
  'Lithuania',
  'Malaysia',
  'Mexico',
  'Moldova',
  'Mongolia',
  'Morocco',
  'Myanmar',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Nicaragua',
  'North Korea',
  'Norway',
  'Oman',
  'Pakistan',
  'Palestine',
  'Panama',
  'Paraguay',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Romania',
  'Russia',
  'Saudi Arabia',
  'Serbia',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'South Korea',
  'Spain',
  'Sri Lanka',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tajikistan',
  'Thailand',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uruguay',
  'Uzbekistan',
  'Venezuela',
  'Vietnam',
  'Yemen',
] as const

export default async function ProviderIdentityVerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ upload_error?: string; uploaded?: string; missing?: string; error?: string }>
}) {
  const { token } = await params
  const feedback = buildFeedback(searchParams ? await searchParams : undefined)
  const verification = await resolveForPage(token)
  if (!verification) return <ExpiredLink />
  const consentVendor = ['NOT_STARTED', 'STARTED'].includes(verification.status)
    ? await resolveIdentityVerificationConsentVendor(verification.id)
    : null

  const documents = await db.providerIdentityDocument.findMany({
    where: { verificationId: verification.id, deletedAt: null },
    select: { id: true, documentKind: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const uploadedKinds = new Set(documents.map((doc) => doc.documentKind))
  // Defensive: an unrecognised basis must not crash the page (getRequiredDocumentKinds
  // is an exhaustive switch that returns undefined for unknown values).
  const identityBasis = isIdentityBasis(verification.identityBasis) ? verification.identityBasis : null
  const requiredKinds = identityBasis ? getRequiredDocumentKinds(identityBasis) : []
  // Show only the kinds relevant to the current step - selfie is always its own step.
  const displayKinds =
    verification.status === 'AWAITING_SELFIE'
      ? requiredKinds.filter((k) => k === 'SELFIE')
      : requiredKinds.filter((k) => k !== 'SELFIE')
  // Source of truth for "may continue": every required file for this step is
  // persisted in the database - selecting a file in the browser is not enough.
  const stepUploadComplete = displayKinds.length > 0 && displayKinds.every((kind) => uploadedKinds.has(kind))

  // Every inline action resolves to a single redirect target. Expected failures
  // and unexpected errors are translated into controlled in-flow URLs so the
  // root error boundary ("Something went wrong") is never reached for them.
  // redirect() itself throws NEXT_REDIRECT, so it stays outside the try/catch.
  async function acceptConsentAction() {
    'use server'
    let target = `/provider/verify/${token}`
    try {
      await acceptIdentityConsent(token)
      // Hosted vendors (Didit) collect ID + selfie + liveness inside their
      // own UI. Skip the PWA identifier/document/selfie steps and hand off
      // straight to the internal /liveness redirect (which 302s to the
      // decrypted Didit URL server-side, keeping the raw URL out of HTML).
      const hosted = await startHostedVerificationFromConsent(token)
      if (hosted.ok && !('alreadyAdvanced' in hosted)) {
        target = `/provider/verify/${token}/liveness`
      }
    } catch (error) {
      target = mapVerificationActionError(token, error, { step: 'consent' })
    }
    redirect(target)
  }

  async function identifierAction(formData: FormData) {
    'use server'
    let target: string
    try {
      const result = await submitIdentityBasisAndIdentifier(token, {
        identityBasis: formData.get('identityBasis')?.toString() as IdentityBasis,
        identifier: formData.get('identifier')?.toString() ?? '',
        issuingCountry: formData.get('issuingCountry')?.toString() ?? undefined,
        nationality: formData.get('nationality')?.toString() ?? undefined,
        documentExpiryDate: formData.get('documentExpiryDate')?.toString() ?? undefined,
      })
      target = identifierStepRedirect(token, result)
    } catch (error) {
      target = mapVerificationActionError(token, error, { step: 'identifier' })
    }
    redirect(target)
  }

  async function documentsDoneAction() {
    'use server'
    let target: string
    try {
      const result = await submitIdentityDocuments(token)
      target = documentStepRedirect(token, result)
    } catch (error) {
      target = mapVerificationActionError(token, error, { step: 'documents' })
    }
    redirect(target)
  }

  async function selfieDoneAction() {
    'use server'
    let target: string
    try {
      const result = await submitIdentitySelfie(token)
      target = selfieStepRedirect(token, result)
    } catch (error) {
      target = mapVerificationActionError(token, error, { step: 'selfie' })
    }
    redirect(target)
  }

  async function submitReviewAction() {
    'use server'
    let target: string
    try {
      const result = await submitIdentityVerificationForReview(token)
      target = reviewStepRedirect(token, result)
    } catch (error) {
      target = mapVerificationActionError(token, error, { step: 'review' })
    }
    redirect(target)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-4 py-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plug A Pro verification</p>
        <h1 className="text-2xl font-semibold tracking-normal">Confirm your identity</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Use this secure page for ID, passport, permit, document and selfie uploads. Do not send those details in a
          WhatsApp message unless support tells you to use the low-data fallback.
        </p>
      </header>

      {!['NEEDS_MANUAL_REVIEW', 'PASSED', 'FAILED'].includes(verification.status) ? (
        <StatusStrip status={verification.status} />
      ) : null}
      {feedback ? <FeedbackBanner feedback={feedback} /> : null}

      {verification.status === 'NOT_STARTED' || verification.status === 'STARTED' ? (
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <h2 className="text-base font-semibold">Consent</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {consentVendor
                ? renderIdentityConsentText(consentVendor.vendorDisplayName)
                : 'Plug A Pro will use your identity details only to verify your provider account, manage trust reviews and meet legal or platform safety obligations.'}
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
            <p className="mt-1 text-sm text-muted-foreground">
              Choose the document you have. The form only asks for the details needed for that document type.
            </p>
          </div>
          <IdentityDetailsForm
            action={identifierAction}
            defaultIdentityBasis={verification.identityBasis as IdentityBasis}
            defaultIssuingCountry={verification.issuingCountry}
            defaultNationality={verification.nationality}
            countryOptions={COUNTRY_OPTIONS}
          />
        </section>
      ) : null}

      {['AWAITING_DOCUMENT', 'AWAITING_SELFIE'].includes(verification.status) ? (
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <h2 className="text-base font-semibold">
              {verification.status === 'AWAITING_SELFIE' ? 'Take a selfie' : 'Upload your ID document'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {verification.status === 'AWAITING_SELFIE'
                ? 'Take a clear selfie of your face in good lighting. Each file is stored privately.'
                : 'Upload a clear photo or PDF of your document. Each file is stored privately.'}
            </p>
          </div>
          {displayKinds.length === 0 ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <p>We could not load your document requirements. Please restart the identity step and try again.</p>
              <Link href="/provider/verification" className="mt-2 inline-block font-medium underline underline-offset-4">
                Open verification help
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {displayKinds.map((kind) => (
                  <form key={kind} action={`/api/provider/identity/upload?token=${encodeURIComponent(token)}`} method="post" encType="multipart/form-data" className="grid gap-2 rounded-md border p-3">
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="verificationId" value={verification.id} />
                    <input type="hidden" name="documentKind" value={kind} />
                    <input type="hidden" name="returnTo" value={`/provider/verify/${token}`} />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{formatKind(kind)}</span>
                      <span className={`text-xs font-medium ${uploadedKinds.has(kind) ? 'text-green-500' : 'text-muted-foreground'}`}>
                        {uploadedKinds.has(kind) ? '✓ uploaded' : 'needed'}
                      </span>
                    </div>
                    {!uploadedKinds.has(kind) && (
                      <>
                        <input name="file" type="file" required accept="image/*,application/pdf" className="text-sm" />
                        <button className="min-h-10 rounded-md border px-3 py-2 text-sm font-medium">Upload {formatKind(kind)}</button>
                      </>
                    )}
                    {uploadedKinds.has(kind) && (
                      <>
                        <input name="file" type="file" accept="image/*,application/pdf" className="text-sm" />
                        <button className="min-h-10 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground">Replace {formatKind(kind)}</button>
                      </>
                    )}
                  </form>
                ))}
              </div>
              {stepUploadComplete ? (
                verification.status === 'AWAITING_DOCUMENT' ? (
                  <form action={documentsDoneAction}>
                    <button className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                      Continue to selfie →
                    </button>
                  </form>
                ) : (
                  <form action={selfieDoneAction}>
                    <button className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                      Submit selfie
                    </button>
                  </form>
                )
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    data-testid="continue-locked"
                    className="min-h-11 w-full cursor-not-allowed rounded-md bg-muted px-4 py-2 text-sm font-medium text-muted-foreground"
                  >
                    {verification.status === 'AWAITING_SELFIE' ? 'Submit selfie' : 'Continue to selfie →'}
                  </button>
                  <p className="text-center text-xs text-muted-foreground">
                    {verification.status === 'AWAITING_SELFIE'
                      ? 'Upload your selfie first to continue.'
                      : 'Upload your document first to continue.'}
                  </p>
                </div>
              )}
            </>
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

      {verification.status === 'AWAITING_LIVENESS' ? (
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <h2 className="text-base font-semibold">Complete face-match</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Open the secure face-match session to finish automated identity verification.
          </p>
          <Link
            href={`/provider/verify/${encodeURIComponent(token)}/liveness`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Complete face-match
          </Link>
        </section>
      ) : null}

      {verification.status === 'PROCESSING' ? (
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <h2 className="text-base font-semibold">Verification in progress</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            We are verifying your details now. Refresh this page in a minute to check the latest status.
          </p>
          <Link
            href={`/provider/verify/${encodeURIComponent(token)}`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md border px-4 py-2 text-sm font-medium"
          >
            Refresh status
          </Link>
        </section>
      ) : null}

      {['NEEDS_MANUAL_REVIEW', 'PASSED', 'FAILED'].includes(verification.status) ? (
        <TerminalHandoff status={verification.status} />
      ) : null}
    </main>
  )
}

const GENERIC_VERIFY_STEP_ERROR = 'That step could not be completed. Please try again.'
const GENERIC_UPLOAD_ERROR = 'Could not store this file. Please try again.'

function buildFeedback(params?: { upload_error?: string; uploaded?: string; missing?: string; error?: string }) {
  // Query params are attacker-controllable via crafted links, so banners use
  // fixed copy instead of reflecting the raw value back on our trusted domain.
  if (params?.error) {
    return { tone: 'error' as const, message: GENERIC_VERIFY_STEP_ERROR }
  }
  if (params?.upload_error) {
    return { tone: 'error' as const, message: GENERIC_UPLOAD_ERROR }
  }
  if (params?.missing === 'selfie') {
    return {
      tone: 'error' as const,
      message: 'Please upload your selfie photo before continuing.',
    }
  }
  if (params?.missing === 'document') {
    return {
      tone: 'error' as const,
      message: 'Please upload your document photo before continuing.',
    }
  }
  if (params?.uploaded) {
    return {
      tone: 'success' as const,
      message: 'File uploaded. Continue when all required files show as uploaded.',
    }
  }
  return null
}

function FeedbackBanner({ feedback }: { feedback: { tone: 'error' | 'success'; message: string } }) {
  const className = feedback.tone === 'error'
    ? 'rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'
    : 'tone-success rounded-lg border px-4 py-3 text-sm'
  return <div className={className}>{feedback.message}</div>
}

async function resolveForPage(token: string) {
  try {
    return await resolveProviderVerificationToken(token)
  } catch {
    return null
  }
}

function ExpiredLink() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plug A Pro verification</p>
      <h1 className="text-2xl font-semibold tracking-normal">Verification link unavailable</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        This secure link is invalid, expired or already complete. Return to WhatsApp and reply <span className="font-semibold">VERIFY</span> to request a new link.
      </p>
      <a
        href={whatsappReturnUrl()}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Back to WhatsApp
      </a>
      <Link href="/provider/verification" className="text-center text-sm font-medium underline underline-offset-4">
        Open verification help
      </Link>
    </main>
  )
}

function TerminalHandoff({ status }: { status: string }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4 text-sm leading-6">
      <h2 className="text-base font-semibold">{terminalTitle(status)}</h2>
      <p className="text-muted-foreground">{terminalCopy(status)}</p>
      <p className="text-muted-foreground">
        Plug A Pro will message you in WhatsApp when there&apos;s an update. You can close this page.
      </p>
      <a
        href={whatsappReturnUrl()}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Back to WhatsApp
      </a>
      <Link
        href="/provider/verification"
        className="block text-center text-sm font-medium underline underline-offset-4"
      >
        Verification help
      </Link>
    </section>
  )
}

function whatsappReturnUrl() {
  const digits = siteConfig.whatsappNumber.replace(/\D/g, '')
  return `https://wa.me/${digits}`
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
