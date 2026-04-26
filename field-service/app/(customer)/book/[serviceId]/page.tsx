// ─── Customer: Job request entry point ────────────────────────────────────────
// Server Component: resolves category from slug, renders client BookingFlow.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
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
}: {
  params: Promise<{ serviceId: string }>
}) {
  const { serviceId: category } = await params
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/book/${category}`)}`)

  const categoryInfo = CATEGORIES[category]
  if (!categoryInfo) notFound()

  const categoryData = {
    slug: category,
    name: categoryInfo.name,
    description: categoryInfo.description,
  }

  return <BookingFlow category={categoryData} />
}
