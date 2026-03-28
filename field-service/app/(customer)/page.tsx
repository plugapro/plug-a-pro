// Customer home — marketing landing page with job category catalogue
// SSR: always fresh
// Mobile-first, link-shareable

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { Wrench, Calendar, Star, ChevronRight } from 'lucide-react'

export const metadata = buildMetadata({
  title: 'Request trusted home services',
  description: 'Fast. Reliable. Guaranteed. Request a job online in minutes.',
})

const CATEGORIES = [
  { slug: 'plumbing',    name: 'Plumbing',     description: 'Leaks, installations, drain clearing and more.' },
  { slug: 'painting',    name: 'Painting',     description: 'Interior and exterior painting services.' },
  { slug: 'garden',      name: 'Garden',       description: 'Lawn care, landscaping, and tree trimming.' },
  { slug: 'handyman',    name: 'Handyman',     description: 'General repairs and odd jobs around the home.' },
  { slug: 'appliances',  name: 'Appliances',   description: 'Repairs and installation of home appliances.' },
  { slug: 'electrical',  name: 'Electrical',   description: 'Wiring, fault-finding, and compliance certificates.' },
  { slug: 'diy',         name: 'DIY & Assembly', description: 'Flat-pack assembly, shelving, and mounting.' },
  { slug: 'roofing',     name: 'Roofing',      description: 'Roof repairs, waterproofing, and inspections.' },
]

export default async function CustomerHomePage() {
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
            Request trusted home services
          </h1>
          <p className="mb-8 text-lg font-medium text-zinc-400 sm:text-xl">
            Fast. Reliable. Guaranteed.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="text-base font-semibold">
              <Link href="/services">
                Request a job
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
              <p className="mb-1 font-semibold">Choose a category</p>
              <p className="text-sm text-muted-foreground">Browse our range of professional home services.</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Calendar className="h-5 w-5" />
              </div>
              <p className="mb-1 font-semibold">Describe your job</p>
              <p className="text-sm text-muted-foreground">Tell us what you need and where.</p>
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

      {/* Category catalogue */}
      <section className="px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-2 text-2xl font-bold tracking-tight">Our services</h2>
          <p className="mb-10 text-sm text-muted-foreground">
            Everything your home needs, requested online in minutes.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.slug}
                href={`/book/${cat.slug}`}
                className="group flex items-start justify-between rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug group-hover:text-primary">
                    {cat.name}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {cat.description}
                  </p>
                </div>
                <div className="ml-4 shrink-0">
                  <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
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
