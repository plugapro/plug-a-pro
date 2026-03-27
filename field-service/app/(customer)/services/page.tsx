// ─── Customer: Browse services ────────────────────────────────────────────────
// Lists all active services grouped by category.
// Auth required — unauthenticated users are redirected to /sign-in.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getSession, resolveBusinessId } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const metadata = buildMetadata({ title: 'Book a Service' })

export default async function ServicesPage() {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  const businessId = await resolveBusinessId()

  const services = await db.service.findMany({
    where: { businessId, active: true },
    orderBy: { sortOrder: 'asc' },
  })

  // Group by category
  const grouped = services.reduce<Record<string, typeof services>>(
    (acc, svc) => {
      const cat = svc.category ?? 'Other'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(svc)
      return acc
    },
    {}
  )

  const categories = Object.keys(grouped).sort()

  return (
    <div className="px-4 py-6 space-y-8 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">Book a Service</h1>

      {services.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center space-y-3">
          <p className="text-muted-foreground">No services available right now.</p>
        </div>
      )}

      {categories.map((category) => (
        <section key={category} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            {category}
          </h2>
          <div className="grid gap-3">
            {grouped[category].map((service) => {
              const priceLabel =
                service.pricingType === 'QUOTE_REQUIRED' || !service.basePrice
                  ? 'Quote required'
                  : `R ${Number(service.basePrice).toFixed(0)}`

              return (
                <Button
                  key={service.id}
                  asChild
                  variant="outline"
                  className="h-auto rounded-xl px-4 py-4 justify-start"
                >
                  <Link href={`/book/${service.id}`}>
                    <div className="flex items-start justify-between gap-3 w-full">
                      <div className="min-w-0 flex-1 text-left">
                        <p className="font-semibold text-sm">{service.name}</p>
                        {service.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {service.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {service.duration} min
                        </p>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <Badge variant="secondary" className="text-xs font-semibold">
                          {priceLabel}
                        </Badge>
                        <p className="text-xs text-muted-foreground">Book →</p>
                      </div>
                    </div>
                  </Link>
                </Button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
