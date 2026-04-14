'use client'

// ─── Suburb Picker — 3-step city → area → suburb cascade ──────────────────────

import { useState } from 'react'
import type { CityOption, RegionOption, SuburbOption } from '@/lib/location-nodes'

// ─── Types ────────────────────────────────────────────────────────────────────

type Selection = {
  suburb: string
  city: string
  locationNodeId: string
}

type Props = {
  initialCities: CityOption[]
  onSelect: (selection: Selection | null) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SuburbPicker({ initialCities, onSelect }: Props) {
  const [selectedCityId, setSelectedCityId] = useState('')
  const [selectedCityLabel, setSelectedCityLabel] = useState('')
  const [selectedRegionId, setSelectedRegionId] = useState('')
  const [selectedSuburbId, setSelectedSuburbId] = useState('')
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [suburbs, setSuburbs] = useState<SuburbOption[]>([])
  const [loadingRegions, setLoadingRegions] = useState(false)
  const [loadingSuburbs, setLoadingSuburbs] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  async function handleCityChange(cityId: string) {
    const city = initialCities.find((c) => c.id === cityId)
    setSelectedCityId(cityId)
    setSelectedCityLabel(city?.label ?? '')
    setSelectedRegionId('')
    setSelectedSuburbId('')
    setRegions([])
    setSuburbs([])
    onSelect(null)
    if (!cityId) return
    setLoadingRegions(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/locations/regions?cityId=${encodeURIComponent(cityId)}`)
      if (res.ok) setRegions(await res.json())
      else setFetchError('Failed to load areas. Please try again.')
    } catch {
      setFetchError('Failed to load areas. Please try again.')
    } finally {
      setLoadingRegions(false)
    }
  }

  async function handleRegionChange(regionId: string) {
    setSelectedSuburbId('')
    setSuburbs([])
    onSelect(null)
    if (!regionId) return
    setLoadingSuburbs(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/locations/suburbs?regionId=${encodeURIComponent(regionId)}`)
      if (res.ok) setSuburbs(await res.json())
      else setFetchError('Failed to load suburbs. Please try again.')
    } catch {
      setFetchError('Failed to load suburbs. Please try again.')
    } finally {
      setLoadingSuburbs(false)
    }
  }

  function handleSuburbChange(suburbId: string) {
    if (!suburbId) {
      onSelect(null)
      return
    }
    const suburb = suburbs.find((s) => s.id === suburbId)
    if (suburb) {
      onSelect({ suburb: suburb.label, city: selectedCityLabel, locationNodeId: suburb.id })
    }
  }

  return (
    <div className="space-y-3">
      {/* City select */}
      <div className="space-y-1">
        <label htmlFor="suburb-picker-city" className="text-sm">
          City
        </label>
        <select
          id="suburb-picker-city"
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          onChange={(e) => handleCityChange(e.target.value)}
          value={selectedCityId}
        >
          <option value="" disabled>
            Select city…
          </option>
          {initialCities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Region select — only shown once a city is selected */}
      {(regions.length > 0 || loadingRegions) && (
        <div className="space-y-1">
          <label htmlFor="suburb-picker-region" className="text-sm">
            Area
          </label>
          <select
            id="suburb-picker-region"
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            onChange={(e) => { setSelectedRegionId(e.target.value); handleRegionChange(e.target.value) }}
            value={selectedRegionId}
            disabled={loadingRegions}
          >
            <option value="" disabled>
              {loadingRegions ? 'Loading…' : 'Select area…'}
            </option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Suburb select — only shown once an area is selected */}
      {(suburbs.length > 0 || loadingSuburbs) && (
        <div className="space-y-1">
          <label htmlFor="suburb-picker-suburb" className="text-sm">
            Suburb
          </label>
          <select
            id="suburb-picker-suburb"
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            onChange={(e) => { setSelectedSuburbId(e.target.value); handleSuburbChange(e.target.value) }}
            value={selectedSuburbId}
            disabled={loadingSuburbs}
          >
            <option value="" disabled>
              {loadingSuburbs ? 'Loading…' : 'Select suburb…'}
            </option>
            {suburbs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {fetchError && (
        <p className="text-sm text-destructive" role="alert">
          {fetchError}
        </p>
      )}
    </div>
  )
}
