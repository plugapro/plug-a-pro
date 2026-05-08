// ─── Customer: Job request entry point ────────────────────────────────────────
// Server Component: resolves category from slug, renders client BookingFlow.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { BookingFlow } from '@/components/customer/BookingFlow'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'

export const metadata = buildMetadata({ title: 'Request a Job' })

// Build a lookup map from the single canonical list so all 15 categories are
// valid routes without any manual maintenance here.
const CATEGORIES = Object.fromEntries(
  SERVICE_CATEGORY_OPTIONS.map((cat) => [
    cat.tag,
    { name: cat.label, description: cat.description },
  ]),
)

export default async function RequestJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceId: string }>
  searchParams: Promise<{ template?: string; provider?: string }>
}) {
  const [{ serviceId: category }, { template: templateId, provider: preferredProviderIdRaw }] = await Promise.all([
    params,
    searchParams,
  ])
  const preferredProviderId = preferredProviderIdRaw?.trim() || null
  const session = await getSession()
  if (!session) {
    const next = new URLSearchParams()
    if (templateId) next.set('template', templateId)
    if (preferredProviderId) next.set('provider', preferredProviderId)
    const nextPath = `/book/${category}${next.toString() ? `?${next.toString()}` : ''}`
    redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`)
  }

  const categoryInfo = CATEGORIES[category]
  if (!categoryInfo) notFound()

  const categoryData = {
    slug: category,
    name: categoryInfo.name,
    description: categoryInfo.description,
  }

  // Fetch saved addresses and flag in parallel — non-fatal if customer not yet created.
  const [customer, addressBookEnabled] = await Promise.all([
    resolveCustomerForSession(db, session),
    isEnabled('feature.customer.address_book', { userId: session.id }),
  ])

  const savedSites = customer
    ? await db.customerAddress.findMany({
        where: { customerId: customer.id },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      })
    : []

  // Resolve template pre-fill — silently ignore invalid/missing ids.
  let initialDraft: { title: string; description: string } | undefined
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
      preferredProviderId={eligiblePreferredProvider?.id ?? null}
    />
  )
}
