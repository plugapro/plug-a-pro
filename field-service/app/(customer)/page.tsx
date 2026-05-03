// Customer home — marketing landing page with job category catalogue
// SSR: always fresh
// Mobile-first, link-shareable

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import type { LucideIcon } from 'lucide-react'
import {
  Star, ChevronRight,
  Wrench, Calendar,
  Droplets, Paintbrush, Leaf, Hammer, Plug, Zap, House,
  SprayCan, Grid2x2, Bug, Wind, HelpCircle, Layers,
} from 'lucide-react'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'

export const metadata = buildMetadata({
  title: 'Request local home services',
  description: 'Describe the job, review written quotes, and choose a nearby provider.',
})

// Icon mapping — one place to maintain as categories evolve.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  plumbing:        Droplets,
  painting:        Paintbrush,
  garden:          Leaf,
  handyman:        Hammer,
  appliances:      Plug,
  electrical:      Zap,
  diy:             Wrench,
  roofing:         House,
  cleaning:        SprayCan,
  tiling:          Grid2x2,
  pest_control:    Bug,
  carpentry:       Hammer,
  waterproofing:   Layers,
  air_conditioning: Wind,
  other:           HelpCircle,
}

const CATEGORIES = SERVICE_CATEGORY_OPTIONS.map((cat) => ({
  slug: cat.tag,
  name: cat.label,
  description: cat.description,
  icon: CATEGORY_ICONS[cat.tag] ?? Wrench,
}))

export default async function CustomerHomePage() {
  return (
    <div className="min-h-screen">
      <section className="relative overflow-hidden px-4 py-16 sm:py-24">
        <div className="app-hero-surface mx-auto max-w-5xl px-6 py-12 text-center sm:px-10 sm:py-16">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border tone-brand px-3 py-1 text-xs font-medium">
            <Star className="h-3 w-3" />
            Built for written quotes and tracked jobs
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Request local home services
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg font-medium text-muted-foreground sm:text-xl">
            Nearby providers. Written quotes. Clear records.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="text-base font-semibold">
              <Link href="/services">
                Request a job
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-base font-semibold">
              <Link href="/bookings">Track my booking</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="px-4 py-14">
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
              <p className="text-sm text-muted-foreground">Choose the type of help you need.</p>
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
              <p className="text-sm text-muted-foreground">We match your request to a nearby provider and keep the job record in writing.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-2 text-2xl font-bold tracking-tight">Our services</h2>
          <p className="mb-10 text-sm text-muted-foreground">
            Request a nearby provider in a few taps and review the quote before work starts.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon
              return (
                <Link
                  key={cat.slug}
                  href={`/book/${cat.slug}`}
                  className="group flex items-center rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug group-hover:text-primary">
                      {cat.name}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {cat.description}
                    </p>
                  </div>
                  <ChevronRight className="ml-3 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      <footer className="border-t border-border/70 px-4 py-8 text-center">
        <p className="text-xs text-muted-foreground">
          © 2026 Plug A Pro. All rights reserved.
        </p>
      </footer>
    </div>
  )
}
