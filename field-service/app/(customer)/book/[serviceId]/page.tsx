// ─── Customer: Booking flow entry point ──────────────────────────────────────
// Server Component: fetches service + businessId, renders client BookingFlow.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getSession, resolveBusinessId } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { BookingFlow } from '@/components/customer/BookingFlow'

export const metadata = buildMetadata({ title: 'Book' })

export default async function BookServicePage({
  params,
}: {
  params: Promise<{ serviceId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  const { serviceId } = await params

  const service = await db.service.findUnique({
    where: { id: serviceId },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      pricingType: true,
      basePrice: true,
      callOutFee: true,
      duration: true,
      active: true,
      businessId: true,
    },
  })

  if (!service || !service.active) notFound()

  const businessId = await resolveBusinessId()

  // Serialise Decimal fields to plain numbers for client component
  const serialised = {
    ...service,
    basePrice: service.basePrice ? Number(service.basePrice) : null,
    callOutFee: service.callOutFee ? Number(service.callOutFee) : null,
  }

  return <BookingFlow service={serialised} businessId={businessId} />
}
