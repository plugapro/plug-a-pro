// ─── Customer: Job request entry point ────────────────────────────────────────
// Server Component: resolves category from slug, renders client BookingFlow.

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { BookingFlow } from '@/components/customer/BookingFlow'
import { getPilotServiceCategories } from '@/lib/service-categories'

export const metadata = buildMetadata({ title: 'Request a Job' })

// Only pilot skills are valid booking routes. Navigating to /book/electrical
// returns 404 until that trade is opened for the pilot.
const CATEGORIES = Object.fromEntries(
  getPilotServiceCategories().map((cat) => [
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
  const [customer, addressBookEnabled] = session
    ? await Promise.all([
        resolveCustomerForSession(db, session),
        isEnabled('feature.customer.address_book', { userId: session.id }),
      ])
    : [null, false] as const

  const savedSites = customer
    ? await db.customerAddress.findMany({
        where: { customerId: customer.id },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        include: { locationNode: { select: { regionKey: true } } },
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
