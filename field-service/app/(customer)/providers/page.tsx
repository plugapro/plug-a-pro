export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { getPilotServiceCategories } from '@/lib/service-categories'
import {
  buildCustomerRequestUrl,
  formatAreaSearchLabel,
  resolveCustomerSearchCategoryTag,
  resolvePilotServiceCategoryTag,
} from '@/lib/customer-search-routing'
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
  const { category, area, q, availability, maxCallOut } = await searchParams
  const requestUrl = buildCustomerRequestUrl({ category, searchTerm: q, area })

  const flagEnabled = await isEnabled('feature.customer.provider_browse')
  if (!flagEnabled) redirect(requestUrl ?? '/')

  const now = new Date()
  const queryResolvedCategory = resolvePilotServiceCategoryTag(q)
  const normalizedCategory =
    resolveCustomerSearchCategoryTag({ category, searchTerm: q }) ??
    category?.trim().toLowerCase() ??
    ''
  const normalizedArea = area?.trim() ?? ''
  const normalizedQuery = q?.trim().toLowerCase() ?? ''
  const providerTextQuery = queryResolvedCategory ? '' : normalizedQuery
  const availableOnly = availability === 'available_now'
  const maxCallOutFee = maxCallOut && Number.isFinite(Number(maxCallOut)) ? Number(maxCallOut) : null
  const areaLabel = formatAreaSearchLabel(normalizedArea)

  const providers = await db.provider.findMany({
    where: {
      active: true,
      verified: true,
      status: 'ACTIVE',
      AND: [
        // Suspension check must live in AND so it cannot be clobbered by any
        // dynamic OR spread below - prior bug allowed suspended providers to
        // appear in results when category + query filters were both active.
        { OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: now } }] },
        ...(normalizedCategory
          ? [
              {
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
              },
            ]
          : []),
        ...(normalizedArea ? [{ serviceAreas: { has: normalizedArea } }] : []),
        ...(availableOnly ? [{ availableNow: true }] : []),
        ...(maxCallOutFee != null
          ? [{ providerRates: { some: { callOutFee: { lte: maxCallOutFee } } } }]
          : []),
        ...(providerTextQuery
          ? [
              {
                OR: [
                  { name: { contains: providerTextQuery, mode: 'insensitive' as const } },
                  { bio: { contains: providerTextQuery, mode: 'insensitive' as const } },
                  {
                    providerCategories: {
                      some: {
                        categorySlug: { contains: providerTextQuery, mode: 'insensitive' as const },
                        approvalStatus: 'APPROVED',
                      },
                    },
                  },
                  { serviceAreas: { has: providerTextQuery } },
                ],
              },
            ]
          : []),
      ],
    },
    take: 100,
    orderBy: { completedJobsCount: 'desc' },
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
    <div className="min-h-screen pb-32 screen-enter">
      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-4">
        <p
          className="text-[11px] font-bold tracking-[0.08em] uppercase mb-1"
          style={{ color: 'var(--brand-purple)' }}
        >
          Browse providers
        </p>
        <h1 className="text-[30px] font-bold tracking-[-0.025em] leading-[1.1]" style={{ color: 'var(--ink)' }}>
          Find a provider
        </h1>
        <p className="mt-1.5 text-[14px]" style={{ color: 'var(--ink-mute)' }}>
          {isSignedIn
            ? 'Search and compare reviewed providers near you.'
            : 'Browse reviewed providers - sign in only when you request service.'}
        </p>
      </div>

      {/* Category filter pills */}
      <div className="flex gap-2 overflow-x-auto px-[18px] pb-3 scrollbar-hide">
        <Link
          href={`/providers${normalizedQuery ? `?q=${encodeURIComponent(normalizedQuery)}` : ''}`}
          className="shrink-0 inline-flex items-center h-8 px-4 rounded-full text-[13px] font-semibold transition-colors duration-150 whitespace-nowrap"
          style={!normalizedCategory
            ? { background: 'var(--brand-purple)', color: '#fff' }
            : { background: 'var(--card-alt)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          All
        </Link>
        {getPilotServiceCategories().map((option) => {
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
              className="shrink-0 inline-flex items-center h-8 px-4 rounded-full text-[13px] font-semibold transition-colors duration-150 whitespace-nowrap"
              style={isActive
                ? { background: 'var(--brand-purple)', color: '#fff' }
                : { background: 'var(--card-alt)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            >
              {option.label}
            </Link>
          )
        })}
      </div>

      {/* Provider list */}
      {rankedProviders.length === 0 ? (
        <div className="px-[18px] mt-4">
          <div className="rounded-[20px] p-6 text-center" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <p className="text-[15px] font-bold mb-1" style={{ color: 'var(--ink)' }}>
              We could not find an exact match in {areaLabel} yet.
            </p>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-mute)' }}>
              You can still send the request and we&apos;ll try to match you with nearby providers.
            </p>
            <div className="mt-4 grid gap-2">
              {requestUrl && (
                <Link
                  href={requestUrl}
                  className="inline-flex h-11 items-center justify-center rounded-[14px] brand-gradient px-4 text-[13px] font-bold text-white"
                >
                  Continue with request
                </Link>
              )}
              <Link
                href={normalizedCategory ? `/providers?category=${encodeURIComponent(normalizedCategory)}` : '/providers'}
                className="inline-flex h-10 items-center justify-center rounded-[14px] px-4 text-[13px] font-semibold"
                style={{ background: 'var(--card-alt)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
              >
                Broaden nearby area
              </Link>
              <Link
                href="/"
                className="inline-flex h-10 items-center justify-center rounded-[14px] px-4 text-[13px] font-semibold"
                style={{ color: 'var(--brand-purple)' }}
              >
                Choose another category
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-[18px]">
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
        </div>
      )}
    </div>
  )
}
