// Customer home — marketing landing page with service catalogue
// SSR: always fresh (services can change)
// Mobile-first, link-shareable

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { db } from '@/lib/db'
import { resolveBusinessId } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { formatCurrency } from '@/lib/payments'
import { Button } from '@/components/ui/button'
import { Wrench, Calendar, Star, ChevronRight, MapPin } from 'lucide-react'

export const metadata = buildMetadata({
  title: 'Book trusted home services',
  description: 'Fast. Reliable. Guaranteed. Book a home service online in minutes.',
})

export default async function CustomerHomePage() {
  const businessId = await resolveBusinessId()

  const services = await db.service.findMany({
    where: { businessId, active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { serviceAreas: { take: 3 } },
  })

  const categories = [...new Set(services.map((s) => s.category))]

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden bg-zinc-950 px-4 py-20 text-center text-white sm:py-28">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-400">
            <Star className="h-3 w-3 text-amber-400" />
            Trusted by homeowners
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Book trusted home services
          </h1>
          <p className="mb-8 text-lg font-medium text-zinc-400 sm:text-xl">
            Fast. Reliable. Guaranteed.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="text-base font-semibold">
              <Link href="/services">
                Book a service
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-zinc-700 bg-transparent text-white hover:bg-zinc-800 text-base font-semibold">
              <Link href="/bookings">Track my booking</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b bg-zinc-50 px-4 py-14 dark:bg-zinc-900/50">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-10 text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            How it works
          </h2>
          <div className="grid gap-8 sm:grid-cols-3">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Wrench className="h-5 w-5" />
              </div>
              <p className="mb-1 font-semibold">Choose a service</p>
              <p className="text-sm text-muted-foreground">Browse our range of professional home services.</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Calendar className="h-5 w-5" />
              </div>
              <p className="mb-1 font-semibold">Pick a time</p>
              <p className="text-sm text-muted-foreground">Select a date and time that works for you.</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Star className="h-5 w-5" />
              </div>
              <p className="mb-1 font-semibold">We&apos;ll be there</p>
              <p className="text-sm text-muted-foreground">A vetted professional arrives on time, every time.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Service catalogue */}
      <section className="px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-2 text-2xl font-bold tracking-tight">Our services</h2>
          <p className="mb-10 text-sm text-muted-foreground">
            Everything your home needs, booked online in minutes.
          </p>

          {services.length === 0 && (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No services available at this time. Check back soon.
              </p>
            </div>
          )}

          {categories.map((category) => (
            <div key={category} className="mb-10">
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {category}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {services
                  .filter((s) => s.category === category)
                  .map((service) => (
                    <Link
                      key={service.id}
                      href={`/book/${service.id}`}
                      className="group flex items-start justify-between rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug group-hover:text-primary">
                          {service.name}
                        </p>
                        {service.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {service.description}
                          </p>
                        )}
                        {service.serviceAreas.length > 0 && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {service.serviceAreas.map((a) => a.city).join(', ')}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="ml-4 shrink-0 text-right">
                        {service.basePrice != null && (
                          <p className="font-bold text-sm">
                            {formatCurrency(Number(service.basePrice))}
                          </p>
                        )}
                        <ChevronRight className="ml-auto mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </Link>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-4 py-8 text-center">
        <p className="text-xs text-muted-foreground">
          Powered by Field Service Platform
        </p>
      </footer>
    </div>
  )
}
