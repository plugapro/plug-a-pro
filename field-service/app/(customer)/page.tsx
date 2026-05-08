export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import {
  ArrowRight,
  Droplets,
  Hammer,
  Zap,
  Paintbrush,
  Sparkles,
  Wrench,
  Search,
  ShieldCheck,
  MessageCircle,
  Users,
  CheckCircle2,
} from 'lucide-react'

export const metadata = buildMetadata({
  title: 'Find trusted service providers near you',
  description:
    'Search providers, compare profiles, request service, and get WhatsApp updates.',
})

const QUICK_CATEGORIES = [
  { label: 'Plumbing', href: '/providers?category=plumbing', icon: Droplets },
  { label: 'Handyman', href: '/providers?category=handyman', icon: Hammer },
  { label: 'Electrical', href: '/providers?category=electrical', icon: Zap },
  { label: 'Carpentry', href: '/providers?category=carpentry', icon: Wrench },
  { label: 'Cleaning', href: '/providers?category=cleaning', icon: Sparkles },
  { label: 'Painting', href: '/providers?category=painting', icon: Paintbrush },
  { label: 'Appliance Repairs', href: '/providers?category=appliances', icon: Wrench },
  { label: 'Geyser', href: '/providers?category=plumbing&q=geyser', icon: Droplets },
]

export default async function CustomerHomePage() {
  return (
    <main className="mx-auto w-full max-w-lg space-y-6 px-4 py-6">
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <p className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
          <ShieldCheck className="h-3.5 w-3.5" />
          Mobile service marketplace
        </p>
        <h1 className="mt-3 text-2xl font-semibold leading-tight">
          Find trusted service providers near you
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Search for plumbers, handymen, electricians, carpenters and more. Compare profiles,
          request service, and get updates on WhatsApp.
        </p>

        <form action="/providers" method="get" className="mt-4">
          <label htmlFor="provider-search" className="sr-only">
            Search providers
          </label>
          <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              id="provider-search"
              name="q"
              placeholder="Search plumbers, handymen, carpenters..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </form>

        <div className="mt-4 grid grid-cols-1 gap-2">
          <Button asChild size="lg" className="justify-between">
            <Link href="/providers">
              Find a provider
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="justify-between">
            <Link href="/services">
              Request a service
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary" className="justify-between">
            <Link href="/provider-sign-in">
              Join as a service provider
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Browse by category
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {QUICK_CATEGORIES.map((category) => {
            const Icon = category.icon
            return (
              <Link
                key={category.label}
                href={category.href}
                className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm font-medium hover:bg-muted/40"
              >
                <Icon className="h-4 w-4 text-primary" />
                <span className="truncate">{category.label}</span>
              </Link>
            )
          })}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <p className="text-sm font-medium">Where do you need help?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add your suburb or city in provider search to find a closer match.
        </p>
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          How it works
        </p>
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <Search className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="font-medium">Search providers</p>
              <p className="text-muted-foreground">Find by category and area.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="font-medium">Compare profiles</p>
              <p className="text-muted-foreground">Review service areas, experience, and trust signals.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Wrench className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="font-medium">Request service</p>
              <p className="text-muted-foreground">Start your request and we route it through the qualified flow.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MessageCircle className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="font-medium">Get updates on WhatsApp</p>
              <p className="text-muted-foreground">Track matching, provider confirmation, and progress.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Are you a service provider?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Apply to receive job opportunities through WhatsApp.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href="/provider-sign-in">Join as provider</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <a href="https://wa.me/?text=join%20plug%20a%20pro" target="_blank" rel="noopener noreferrer">
              Apply on WhatsApp
            </a>
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-muted/40 p-4 text-sm">
        <div className="flex items-start gap-2 text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
          <p>Providers are reviewed before receiving work opportunities.</p>
        </div>
        <div className="mt-2 flex items-start gap-2 text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
          <p>Your exact address and phone number are only shared after a provider accepts your request.</p>
        </div>
      </section>

      <footer className="pb-4 pt-1 text-center">
        <p className="text-xs text-muted-foreground">
          © 2026 Plug A Pro. Customer requests and provider job acceptance are tracked end-to-end.
        </p>
      </footer>
    </main>
  )
}
