// ─── Customer: Job request entry point ────────────────────────────────────────
// Server Component: resolves category from slug, renders client BookingFlow.

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { resolveReusableCustomerSites } from '@/lib/customer-address-book'
import { getStructuredAddressSelectionBySlug } from '@/lib/location-nodes'
import { formatAreaSearchLabel } from '@/lib/customer-search-routing'
import { buildMetadata } from '@/lib/metadata'
import { BookingFlow } from '@/components/customer/BookingFlow'
import { SERVICE_CATEGORY_OPTIONS, getPilotServiceCategories } from '@/lib/service-categories'

export const metadata = buildMetadata({ title: 'Request a Job' })

// Pilot skills and the "other" capture fallback are valid booking routes.
// Restricted real trades such as /book/electrical still 404 until opened.
const CATEGORIES = Object.fromEntries(
  [
    ...getPilotServiceCategories(),
    ...SERVICE_CATEGORY_OPTIONS.filter((cat) => cat.tag === 'other'),
  ].map((cat) => [
    cat.tag,
    { name: cat.label, description: cat.description },
  ]),
)

export default async function RequestJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceId: string }>
  searchParams: Promise<{ template?: string; provider?: string; q?: string; area?: string }>
}) {
  const [{ serviceId: category }, { template: templateId, provider: preferredProviderIdRaw, q, area }] = await Promise.all([
    params,
    searchParams,
  ])
  const preferredProviderId = preferredProviderIdRaw?.trim() || null
  const searchTerm = q?.trim() || ''
  const areaSlug = area?.trim() || ''
  const session = await getSession()

  const categoryInfo = CATEGORIES[category]
  if (!categoryInfo) notFound()

  const categoryData = {
    slug: category,
    name: categoryInfo.name,
    description: categoryInfo.description,
  }

  // Logged-out visitors can complete the request draft; auth is enforced when
  // the booking API receives the submit. Customer-specific saved-site/template
  // data is loaded only after a session exists.
  const customer = session
    ? await resolveCustomerForSession(db, session)
    : null

  const savedSites = customer
    ? await resolveReusableCustomerSites({
        customerId: customer.id,
        authUserId: session?.id ?? null,
        customerPhone: session?.phone ?? customer.phone,
        source: 'pwa',
      })
    : []

  const addressBookEnabled = Boolean(session && customer && savedSites.length > 0)

  // Resolve template pre-fill - silently ignore invalid/missing ids.
  let initialDraft: {
    title?: string
    description?: string
    subcategory?: string
  } | undefined
  if (templateId && customer) {
    const template = await db.jobRequest.findFirst({
      where: { id: templateId, customerId: customer.id },
      select: { title: true, description: true },
    })
    if (template) {
      initialDraft = {
        title: template.title,
        description: template.description ?? '',
      }
    }
  }
  if (searchTerm) {
    const searchDraft = category === 'other'
      ? { title: searchTerm, subcategory: searchTerm }
      : { subcategory: searchTerm }
    initialDraft = { ...searchDraft, ...initialDraft }
  }

  const initialAddress = areaSlug
    ? await getStructuredAddressSelectionBySlug(areaSlug).catch((err) => {
        console.warn('[book] area prefill lookup failed', { areaSlug, err })
        return null
      })
    : null
  const initialAreaLabel = areaSlug && !initialAddress ? formatAreaSearchLabel(areaSlug) : null

  const eligiblePreferredProvider = preferredProviderId
    ? await db.provider.findFirst({
        where: {
          id: preferredProviderId,
          active: true,
          verified: true,
          status: 'ACTIVE',
          AND: [
            { OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: new Date() } }] },
            {
              OR: [
                {
                  providerCategories: {
                    some: {
                      categorySlug: category,
                      approvalStatus: 'APPROVED',
                    },
                  },
                },
                {
                  AND: [
                    { providerCategories: { none: {} } },
                    { skills: { has: category } },
                  ],
                },
              ],
            },
          ],
        },
        select: { id: true },
      })
    : null

  return (
    <BookingFlow
      category={categoryData}
      savedSites={savedSites}
      addressBookEnabled={addressBookEnabled}
      initialDraft={initialDraft}
      initialAddress={initialAddress}
      initialAreaLabel={initialAreaLabel}
      preferredProviderId={eligiblePreferredProvider?.id ?? null}
    />
  )
}
