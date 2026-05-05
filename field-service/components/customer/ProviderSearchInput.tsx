'use client'

import { useMemo, useState } from 'react'
import { ProviderCard } from '@/components/shared/ProviderCard'

type SearchableProvider = {
  id: string
  name: string
  bio: string | null
  avatarUrl: string | null
  skills: string[]
  serviceArea: string | null
  averageRating: number
  completedJobsCount: number
  verified: boolean
  availableNow: boolean
}

type ProviderSearchInputProps = {
  providers: SearchableProvider[]
}

export function ProviderSearchInput({ providers }: ProviderSearchInputProps) {
  // Track the local query so the list can be filtered in the browser without a request.
  const [searchTerm, setSearchTerm] = useState('')
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()

  // Filter the already-loaded provider payload (top 20) by name + bio.
  const visibleProviders = useMemo(() => {
    if (!normalizedSearchTerm) return providers

    return providers.filter((provider) => {
      const matchesName = provider.name.toLowerCase().includes(normalizedSearchTerm)
      const matchesBio = (provider.bio ?? '').toLowerCase().includes(normalizedSearchTerm)
      return matchesName || matchesBio
    })
  }, [providers, normalizedSearchTerm])

  return (
    <div className="space-y-4">
      <input
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Search by provider name or bio"
        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
        aria-label="Search providers"
      />

      {visibleProviders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No providers match your search
        </p>
      ) : (
        <div className="space-y-3">
          {visibleProviders.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={{
                id: provider.id,
                name: provider.name,
                avatarUrl: provider.avatarUrl,
                skills: provider.skills,
                serviceArea: provider.serviceArea,
                averageRating: provider.averageRating,
                completedJobsCount: provider.completedJobsCount,
                verified: provider.verified,
                availableNow: provider.availableNow,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
