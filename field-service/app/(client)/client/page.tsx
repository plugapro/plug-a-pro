import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { redirect } from 'next/navigation'
import { ClientHomeScreen } from '@/components/client/home-screen'

export const dynamic = 'force-dynamic'

export default async function ClientHomePage() {
  const session = await getSession()
  if (!session || session.role !== 'customer') redirect('/sign-in?next=/client')
  const customer = await resolveCustomerForSession(db, session)
  if (!customer) redirect('/sign-in?next=/client')

  const [requests, jobs] = await Promise.all([
    db.jobRequest.findMany({
      where: {
        customerId: customer.id,
        status: { in: ['PENDING_VALIDATION', 'OPEN', 'MATCHING', 'SHORTLIST_READY', 'PROVIDER_CONFIRMATION_PENDING'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, status: true },
    }),
    db.job.findMany({
      where: { booking: { match: { jobRequest: { customerId: customer.id } } }, status: { notIn: ['FAILED', 'CANCELLED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, status: true, booking: { select: { match: { select: { jobRequest: { select: { title: true } } } } } } },
    }),
  ])

  return (
    <ClientHomeScreen
      name={customer.name}
      requests={requests.map((item) => ({ id: item.id, title: item.title, status: item.status }))}
      jobs={jobs.map((job) => ({
        id: job.id,
        title: job.booking.match.jobRequest.title,
        status: job.status,
      }))}
    />
  )
}

