'use client'

import { useMemo, useState } from 'react'
import { ProviderCard } from '@/components/shared/ProviderCard'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { normaliseLocationDisplayName } from '@/lib/location-format'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'

type SearchableProvider = {
  id: string
  name: string
  bio: string | null
  avatarUrl: string | null
  skills: string[]
  mainCategory: string | null
  subServices: string[]
  experience: string | null
  serviceArea: string | null
  averageRating: number
  completedJobsCount: number
  verified: boolean
  availableNow: boolean
  callOutFee: number | null
  hourlyRate: number | null
  rateNegotiable: boolean
}

type ProviderSearchInputProps = {
  providers: SearchableProvider[]
  selectedCategory?: string | null
  selectedArea?: string | null
}

const CATEGORY_LABELS = new Map(SERVICE_CATEGORY_OPTIONS.map((option) => [option.tag, option.label]))

function categoryLabel(tag: string | null | undefined) {
  if (!tag) return 'General'
  return CATEGORY_LABELS.get(tag) ?? tag.replaceAll('_', ' ')
}

export function ProviderSearchInput({
  providers,
  selectedCategory,
  selectedArea,
}: ProviderSearchInputProps) {
  // Track the local query so the list can be filtered in the browser without a request.
  const [searchTerm, setSearchTerm] = useState('')
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()

  // Filter the already-loaded provider payload (top 20) by name + bio + skills + area.
  const visibleProviders = useMemo(() => {
    if (!normalizedSearchTerm) return providers

    return providers.filter((provider) => {
      const matchesName = provider.name.toLowerCase().includes(normalizedSearchTerm)
      const matchesBio = (provider.bio ?? '').toLowerCase().includes(normalizedSearchTerm)
      const matchesSkills = provider.skills.some((skill) => skill.toLowerCase().includes(normalizedSearchTerm))
      const matchesArea = (provider.serviceArea ?? '').toLowerCase().includes(normalizedSearchTerm)
      const matchesCategory = (provider.mainCategory ?? '').toLowerCase().includes(normalizedSearchTerm)
      const matchesSubServices = provider.subServices.some((item) => item.toLowerCase().includes(normalizedSearchTerm))
      return matchesName || matchesBio || matchesSkills || matchesArea || matchesCategory || matchesSubServices
    })
  }, [providers, normalizedSearchTerm])

  return (
    <div className="space-y-4">
      <input
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Search plumbers, handymen, carpenters..."
        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
        aria-label="Search providers"
      />

      <p className="text-xs text-muted-foreground">
        {selectedCategory ? `Category: ${categoryLabel(selectedCategory)}` : 'All categories'}
        {selectedArea ? ` · Area: ${normaliseLocationDisplayName(selectedArea)}` : ''}
      </p>

      {visibleProviders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No providers match your search
        </p>
      ) : (
        <div className="space-y-3">
          {visibleProviders.map((provider) => (
            <div key={provider.id} className="rounded-2xl border bg-card p-3 shadow-sm">
              <p className="text-xs text-muted-foreground">
                {categoryLabel(provider.mainCategory)}
                {provider.experience ? ` · ${provider.experience}` : ''}
              </p>

              <ProviderCard
                provider={{
                  id: provider.id,
                  name: provider.name,
                  avatarUrl: provider.avatarUrl,
                  skills: provider.subServices.length > 0 ? provider.subServices : provider.skills,
                  serviceArea: provider.serviceArea,
                  averageRating: provider.averageRating,
                  completedJobsCount: provider.completedJobsCount,
                  verified: provider.verified,
                  availableNow: provider.availableNow,
                  labourRateCents:
                    provider.hourlyRate != null ? Math.round(provider.hourlyRate * 100) : null,
                }}
              />

              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {provider.callOutFee != null ? `Call-out fee: R${provider.callOutFee}` : 'Call-out fee on request'}
                  {provider.rateNegotiable ? ' · Rate negotiable' : ' · Fixed rate'}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/providers/${provider.id}`}>View profile</Link>
                </Button>
                <Button asChild size="sm">
                  <Link
                    href={`/book/${encodeURIComponent(provider.mainCategory ?? provider.skills[0] ?? 'other')}?provider=${encodeURIComponent(provider.id)}`}
                  >
                    Request service
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
