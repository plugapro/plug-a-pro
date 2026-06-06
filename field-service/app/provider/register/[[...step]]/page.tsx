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

const ALLOWED_STEPS = new Set(['welcome', 'phone', 'profile', 'services', 'area', 'availability', 'review', 'status'])

type StepKey = 'welcome' | 'phone' | 'profile' | 'services' | 'area' | 'availability' | 'review' | 'status'

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

async function resolveAuthenticatedEntryDestination() {
  const session = await getSession()
  if (!session?.phone) return null

  const [application, draft] = await Promise.all([
    findLatestProviderRegistrationApplicationByPhone(db, session.phone).catch(() => null),
    findActiveProviderRegistrationDraft(session.phone),
  ])

  return resolveProviderRegistrationDestination({
    applicationStatus: application?.status ?? 'NONE',
    providerStatus: session.role === 'provider' ? 'ACTIVE' : null,
    hasActiveDraft: Boolean(draft),
    lastCompletedStep: draft?.lastCompletedStep ?? null,
  })
}

function shouldRedirectForRegistrationEntry(requestedStep: StepKey, destinationRoute: string): boolean {
  if (destinationRoute === '/provider') return true
  if (destinationRoute === '/provider/register/status') return requestedStep !== 'status'
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
  if (destination && shouldRedirectForRegistrationEntry(requestedStep as StepKey, destination.route)) {
    redirect(destination.route)
  }

  return (
    <ProviderRegistrationClient
      initialStep={requestedStep as StepKey}
      initialApplicationState={destination?.state ?? null}
      skillOptions={getPilotServiceCategories()}
    />
  )
}
