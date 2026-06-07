import { redirect } from 'next/navigation'
import { ProviderRegistrationClient } from '@/components/provider/registration/ProviderRegistrationClient'
import { getPilotServiceCategories } from '@/lib/service-categories'
import { buildMetadata } from '@/lib/metadata'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { findLatestProviderRegistrationApplicationByPhone } from '@/lib/provider-applications'
import { resolveProviderRegistrationDestination } from '@/lib/provider-registration/resolver'

export const dynamic = 'force-dynamic'
export const metadata = buildMetadata({ title: 'Provider registration', noIndex: true })

const ALLOWED_STEPS = new Set([
  'welcome',
  'phone',
  'otp',
  'conflict',
  'profile',
  'services',
  'area',
  'availability',
  'verify',
  'evidence',
  'review',
  'submitted',
  'draft',
  'status',
])

type StepKey =
  | 'welcome'
  | 'phone'
  | 'otp'
  | 'conflict'
  | 'profile'
  | 'services'
  | 'area'
  | 'availability'
  | 'verify'
  | 'evidence'
  | 'review'
  | 'submitted'
  | 'draft'
  | 'status'

const DRAFT_CONTINUATION_STEPS = new Set<StepKey>([
  'draft',
  'profile',
  'services',
  'area',
  'availability',
  'verify',
  'evidence',
  'review',
])

async function findActiveProviderRegistrationDraft(phone: string) {
  const draftClient = (db as any).providerApplicationDraft
  if (!draftClient?.findFirst) return null
  return draftClient.findFirst({
    where: {
      phone,
      submittedApplicationId: null,
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, lastCompletedStep: true },
  }).catch(() => null)
}

function applicationReference(id?: string | null) {
  return id ? id.slice(-8).toUpperCase() : null
}

function draftResumeStep(lastCompletedStep?: number | null): StepKey {
  if (!lastCompletedStep || lastCompletedStep <= 1) return 'profile'
  if (lastCompletedStep >= 8) return 'review'

  const nextSteps: Record<number, StepKey> = {
    2: 'services',
    3: 'area',
    4: 'availability',
    5: 'verify',
    6: 'evidence',
    7: 'review',
  }

  return nextSteps[lastCompletedStep] ?? 'profile'
}

async function resolveAuthenticatedEntryDestination() {
  const session = await getSession()
  if (!session?.phone) return null

  const [application, draft] = await Promise.all([
    findLatestProviderRegistrationApplicationByPhone(db, session.phone).catch(() => null),
    findActiveProviderRegistrationDraft(session.phone),
  ])

  const destination = resolveProviderRegistrationDestination({
    applicationStatus: application?.status ?? 'NONE',
    providerStatus: session.role === 'provider' ? 'ACTIVE' : null,
    hasActiveDraft: Boolean(draft),
    lastCompletedStep: draft?.lastCompletedStep ?? null,
  })

  return {
    ...destination,
    applicationRef: applicationReference(application?.id),
    draftResumeStep: draftResumeStep(draft?.lastCompletedStep),
  }
}

function shouldRedirectForRegistrationEntry(requestedStep: StepKey, destinationRoute: string): boolean {
  if (destinationRoute === '/provider') return true
  if (destinationRoute === '/provider/register/status') return requestedStep !== 'status' && requestedStep !== 'submitted'
  if (destinationRoute === '/provider/register/draft') return !DRAFT_CONTINUATION_STEPS.has(requestedStep)
  if (destinationRoute === '/provider/register/welcome') return false
  return requestedStep === 'welcome'
}

export default async function ProviderRegistrationPage({
  params,
}: {
  params: Promise<{ step?: string[] }>
}) {
  const resolvedParams = await params
  const requestedStep = resolvedParams.step?.[0] ?? 'welcome'

  if (!ALLOWED_STEPS.has(requestedStep)) {
    redirect('/provider/register')
  }

  const destination = await resolveAuthenticatedEntryDestination()
  if (requestedStep === 'submitted' && destination?.route !== '/provider/register/status') {
    redirect('/provider/register')
  }
  if (destination && shouldRedirectForRegistrationEntry(requestedStep as StepKey, destination.route)) {
    redirect(destination.route)
  }

  return (
    <ProviderRegistrationClient
      initialStep={requestedStep as StepKey}
      initialApplicationState={destination?.state ?? null}
      initialApplicationRef={destination?.applicationRef ?? null}
      initialDraftResumeStep={destination?.draftResumeStep ?? 'profile'}
      skillOptions={getPilotServiceCategories()}
    />
  )
}
