export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'
import { ProviderSearchInput } from '@/components/customer/ProviderSearchInput'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Find a Provider' })

type ProviderAvailabilityState = 'AVAILABLE' | 'UNAVAILABLE' | 'PAUSED' | 'OFFLINE' | 'TEMP_OFFLINE' | string

type RankedProviderRow = {
  id: string
  name: string
  bio: string | null
  skills: string[]
  serviceAreas: string[]
  averageRating: number
  completedJobsCount: number
  verified: boolean
  avatarUrl: string | null
  availableNow: boolean
  reliabilityScore: number
  strikes: number
  technicianAvailability: {
    availabilityState: ProviderAvailabilityState
  } | null
}

// Composite score combines business trust and readiness:
// - availability now
// - historical reliability metrics
// - customer-facing quality signals (rating + completed jobs)
// - trust/safety signal from verification status
// - operational penalty from strikes
function scoreProviderForCatalogue(provider: RankedProviderRow): number {
  const availabilityScore = provider.availableNow || provider.technicianAvailability?.availabilityState === 'AVAILABLE'
    ? 1
    : 0
  const isPausedOrOffline =
    provider.technicianAvailability?.availabilityState === 'PAUSED' ||
    provider.technicianAvailability?.availabilityState === 'OFFLINE'
  const pausedPenalty = isPausedOrOffline ? 0.75 : 0
  const reliabilityScore = Math.min(Math.max(provider.reliabilityScore, 0), 1)
  const ratingScore = Math.max(0, Math.min(provider.averageRating / 5, 1))
  const completionScore = Math.min(provider.completedJobsCount, 200) / 200
  const verificationBonus = provider.verified ? 1 : 0
  const strikePenalty = Math.min(Math.max(provider.strikes, 0), 10) * 0.08

  return (
    (availabilityScore * 2) +
    (reliabilityScore * 1.6) +
    (ratingScore * 1.2) +
    (completionScore * 1.0) +
    (verificationBonus * 0.8) -
    pausedPenalty -
    strikePenalty
  )
}

export default async function ProviderCataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; area?: string }>
}) {
  const session = await getSession()
  const isSignedIn = Boolean(session)

  const flagEnabled = await isEnabled('feature.customer.provider_browse')
  if (!flagEnabled) redirect('/')

  const { category, area } = await searchParams

  const providers = await db.provider.findMany({
    where: {
      active: true,
      verified: true,
      ...(category ? { skills: { has: category } } : {}),
      ...(area ? { serviceAreas: { has: area } } : {}),
    },
    take: 100,
    select: {
      id: true,
      name: true,
      bio: true,
      skills: true,
      serviceAreas: true,
      averageRating: true,
      completedJobsCount: true,
      verified: true,
      avatarUrl: true,
      availableNow: true,
      reliabilityScore: true,
      strikes: true,
      technicianAvailability: {
        select: {
          availabilityState: true,
        },
      },
    },
  })

  const rankedProviders = providers
    .map((provider) => ({
      ...provider,
      score: scoreProviderForCatalogue(provider),
    }))
    .sort((a, b) =>
      b.score - a.score ||
      (b.reliabilityScore ?? 0) - (a.reliabilityScore ?? 0) ||
      (b.averageRating ?? 0) - (a.averageRating ?? 0) ||
      (b.completedJobsCount ?? 0) - (a.completedJobsCount ?? 0)
    )
    .slice(0, 20)

  return (
    <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Find a Provider</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isSignedIn
            ? 'Browse verified service providers near you.'
            : 'Browse verified service providers and sign in when you are ready to request one.'}
        </p>
      </div>

      {/* Category filter bar */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
        <Link
          href="/providers"
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            !category
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-muted'
          }`}
        >
          All
        </Link>
        {SERVICE_CATEGORY_OPTIONS.filter((o) => o.tag !== 'other').map((option) => {
          const isActive = category === option.tag
          return (
            <Link
              key={option.tag}
              href={`/providers?category=${option.tag}${area ? `&area=${area}` : ''}`}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              }`}
            >
              {option.label}
            </Link>
          )
        })}
      </div>

      {/* Provider list */}
      {rankedProviders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          No providers found for this filter.
        </p>
      ) : (
        <ProviderSearchInput
          providers={rankedProviders.map((provider) => ({
            id: provider.id,
            name: provider.name,
            bio: provider.bio,
            avatarUrl: provider.avatarUrl,
            skills: provider.skills,
            serviceArea: provider.serviceAreas[0] ?? null,
            averageRating: provider.averageRating,
            completedJobsCount: provider.completedJobsCount,
            verified: provider.verified,
            availableNow: provider.availableNow,
          }))}
        />
      )}
    </div>
  )
}
