export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'
import { ProviderSearchInput } from '@/components/customer/ProviderSearchInput'
import { buildMetadata } from '@/lib/metadata'
import { Prisma } from '@prisma/client'

export const metadata = buildMetadata({ title: 'Find a Provider' })

type ProviderAvailabilityState = 'AVAILABLE' | 'UNAVAILABLE' | 'PAUSED' | 'OFFLINE' | 'TEMP_OFFLINE' | string

type RankedProviderRow = {
  id: string
  name: string
  bio: string | null
  skills: string[]
  serviceAreas: string[]
  experience: string | null
  averageRating: number
  completedJobsCount: number
  verified: boolean
  avatarUrl: string | null
  availableNow: boolean
  reliabilityScore: number
  strikes: number
  providerCategories: Array<{
    categorySlug: string
    subServices: string[]
    yearsExperience: number | null
    approvalStatus: string
  }>
  providerRates: Array<{
    categorySlug: string
    callOutFee: Prisma.Decimal | null
    hourlyRate: Prisma.Decimal | null
    rateNegotiable: boolean
  }>
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
  searchParams: Promise<{
    category?: string
    area?: string
    q?: string
    availability?: string
    maxCallOut?: string
  }>
}) {
  const session = await getSession()
  const isSignedIn = Boolean(session)

  const flagEnabled = await isEnabled('feature.customer.provider_browse')
  if (!flagEnabled) redirect('/')

  const { category, area, q, availability, maxCallOut } = await searchParams
  const now = new Date()
  const normalizedCategory = category?.trim().toLowerCase() ?? ''
  const normalizedArea = area?.trim() ?? ''
  const normalizedQuery = q?.trim().toLowerCase() ?? ''
  const availableOnly = availability === 'available_now'
  const maxCallOutFee = maxCallOut && Number.isFinite(Number(maxCallOut)) ? Number(maxCallOut) : null

  const providers = await db.provider.findMany({
    where: {
      active: true,
      verified: true,
      status: 'ACTIVE',
      OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: now } }],
      ...(normalizedCategory
        ? {
            OR: [
              {
                providerCategories: {
                  some: {
                    categorySlug: normalizedCategory,
                    approvalStatus: 'APPROVED',
                  },
                },
              },
              {
                AND: [
                  { providerCategories: { none: {} } },
                  { skills: { has: normalizedCategory } },
                ],
              },
            ],
          }
        : {}),
      ...(normalizedArea ? { serviceAreas: { has: normalizedArea } } : {}),
      ...(availableOnly ? { availableNow: true } : {}),
      ...(maxCallOutFee != null
        ? {
            providerRates: {
              some: {
                callOutFee: { lte: maxCallOutFee },
              },
            },
          }
        : {}),
      ...(normalizedQuery
        ? {
            OR: [
              { name: { contains: normalizedQuery, mode: 'insensitive' } },
              { bio: { contains: normalizedQuery, mode: 'insensitive' } },
              { skills: { has: normalizedQuery } },
              { serviceAreas: { has: normalizedQuery } },
            ],
          }
        : {}),
    },
    take: 100,
    select: {
      id: true,
      name: true,
      bio: true,
      experience: true,
      skills: true,
      serviceAreas: true,
      averageRating: true,
      completedJobsCount: true,
      verified: true,
      avatarUrl: true,
      availableNow: true,
      reliabilityScore: true,
      strikes: true,
      providerCategories: {
        where: {
          approvalStatus: 'APPROVED',
          ...(normalizedCategory ? { categorySlug: normalizedCategory } : {}),
        },
        orderBy: { categorySlug: 'asc' },
        select: {
          categorySlug: true,
          subServices: true,
          yearsExperience: true,
          approvalStatus: true,
        },
      },
      providerRates: {
        where: {
          ...(normalizedCategory ? { categorySlug: normalizedCategory } : {}),
        },
        orderBy: { categorySlug: 'asc' },
        select: {
          categorySlug: true,
          callOutFee: true,
          hourlyRate: true,
          rateNegotiable: true,
        },
      },
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
            ? 'Search and compare reviewed providers near you.'
            : 'Browse reviewed providers now, then sign in only when you request service.'}
        </p>
      </div>

      {/* Category filter bar */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
        <Link
          href={`/providers${normalizedQuery ? `?q=${encodeURIComponent(normalizedQuery)}` : ''}`}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            !normalizedCategory
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-muted'
          }`}
        >
          All
        </Link>
        {SERVICE_CATEGORY_OPTIONS.filter((o) => o.tag !== 'other').map((option) => {
          const isActive = normalizedCategory === option.tag
          const query = new URLSearchParams()
          query.set('category', option.tag)
          if (normalizedArea) query.set('area', normalizedArea)
          if (normalizedQuery) query.set('q', normalizedQuery)
          if (availableOnly) query.set('availability', 'available_now')
          if (maxCallOutFee != null) query.set('maxCallOut', String(maxCallOutFee))
          return (
            <Link
              key={option.tag}
              href={`/providers?${query.toString()}`}
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
          selectedCategory={normalizedCategory || null}
          selectedArea={normalizedArea || null}
          providers={rankedProviders.map((provider) => ({
            id: provider.id,
            name: provider.name,
            bio: provider.bio,
            avatarUrl: provider.avatarUrl,
            skills: provider.skills,
            mainCategory:
              provider.providerCategories[0]?.categorySlug ??
              provider.skills[0] ??
              null,
            subServices: provider.providerCategories[0]?.subServices ?? [],
            experience:
              provider.providerCategories[0]?.yearsExperience != null
                ? `${provider.providerCategories[0].yearsExperience} years`
                : provider.experience,
            serviceArea: provider.serviceAreas[0] ?? null,
            averageRating: provider.averageRating,
            completedJobsCount: provider.completedJobsCount,
            verified: provider.verified,
            availableNow: provider.availableNow,
            callOutFee: provider.providerRates[0]?.callOutFee?.toNumber() ?? null,
            hourlyRate: provider.providerRates[0]?.hourlyRate?.toNumber() ?? null,
            rateNegotiable: provider.providerRates[0]?.rateNegotiable ?? true,
          }))}
        />
      )}
    </div>
  )
}
