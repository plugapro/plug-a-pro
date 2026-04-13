// ─── Customer: Job request entry point ────────────────────────────────────────
// Server Component: resolves category from slug, renders client BookingFlow.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { BookingFlow } from '@/components/customer/BookingFlow'

export const metadata = buildMetadata({ title: 'Request a Job' })

const CATEGORIES: Record<string, { name: string; description: string }> = {
  plumbing:   { name: 'Plumbing',       description: 'Leaks, installations, drain clearing and more.' },
  painting:   { name: 'Painting',       description: 'Interior and exterior painting services.' },
  garden:     { name: 'Garden',         description: 'Lawn care, landscaping, and tree trimming.' },
  handyman:   { name: 'Handyman',       description: 'General repairs and odd jobs around the home.' },
  appliances: { name: 'Appliances',     description: 'Repairs and installation of home appliances.' },
  electrical: { name: 'Electrical',     description: 'Wiring, fault-finding, and compliance certificates.' },
  diy:        { name: 'DIY & Assembly', description: 'Flat-pack assembly, shelving, and mounting.' },
  roofing:    { name: 'Roofing',        description: 'Roof repairs, waterproofing, and inspections.' },
}

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
