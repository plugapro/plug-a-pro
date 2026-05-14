'use client'

import { useMemo, useState } from 'react'
import { ProviderCard } from '@/components/shared/ProviderCard'
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

const CATEGORY_HUES: Record<string, string> = {
  plumbing: '#2A78F0',
  electrical: '#FFC22B',
  handyman: '#8B3FE8',
  carpentry: '#C8854D',
  painting: '#FF1F8E',
  cleaning: '#0FA28A',
  appliances: '#5B5B66',
  gas: '#E5484D',
}

export function ProviderSearchInput({
  providers,
  selectedCategory,
  selectedArea,
}: ProviderSearchInputProps) {
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
    <div className="space-y-3">
      <input
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Search plumbers, handymen, carpenters..."
        className="w-full h-[44px] rounded-[14px] px-4 text-[14px] outline-none transition-[box-shadow]"
        style={{
          background: 'var(--card)',
          color: 'var(--ink)',
          boxShadow: 'inset 0 0 0 1px var(--border)',
        }}
        aria-label="Search providers"
      />

      <p className="text-[12px]" style={{ color: 'var(--ink-mute)' }}>
        {selectedCategory ? `Category: ${categoryLabel(selectedCategory)}` : 'All categories'}
        {selectedArea ? ` · Area: ${normaliseLocationDisplayName(selectedArea)}` : ''}
      </p>

      {visibleProviders.length === 0 ? (
        <div
          className="rounded-[20px] p-8 text-center"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <p className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>No providers match your search</p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-mute)' }}>Try a different term or browse all categories.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleProviders.map((provider) => (
            <ProviderCard
              key={provider.id}
              href={`/providers/${provider.id}`}
              provider={{
                id: provider.id,
                name: provider.name,
                avatarUrl: provider.avatarUrl,
                skills: provider.subServices.length > 0 ? provider.subServices : provider.skills,
                experience: provider.experience,
                serviceArea: provider.serviceArea,
                averageRating: provider.averageRating,
                completedJobsCount: provider.completedJobsCount,
                verified: provider.verified,
                availableNow: provider.availableNow,
                callOutFee: provider.callOutFee,
                rateNegotiable: provider.rateNegotiable,
                tone: CATEGORY_HUES[provider.mainCategory ?? ''],
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
