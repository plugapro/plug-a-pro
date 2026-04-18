'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CityOption, RegionOption, SuburbOption } from '@/lib/location-nodes'

type Selection = {
  province: string
  region: string
  suburb: string
  city: string
  postalCode: string
  locationNodeId: string
}

type Props = {
  initialCities: CityOption[]
  provinceKey: string
  onSelect: (selection: Selection | null) => void
}

export function SuburbPicker({ initialCities, provinceKey, onSelect }: Props) {
  const [selectedCityId, setSelectedCityId] = useState('')
  const [selectedRegionId, setSelectedRegionId] = useState('')
  const [selectedSuburbId, setSelectedSuburbId] = useState('')
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [suburbs, setSuburbs] = useState<SuburbOption[]>([])
  const [loadingRegions, setLoadingRegions] = useState(false)
  const [loadingSuburbs, setLoadingSuburbs] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const filteredCities = useMemo(
    () => initialCities.filter((city) => city.provinceKey === provinceKey),
    [initialCities, provinceKey],
  )

  useEffect(() => {
    setSelectedCityId('')
    setSelectedRegionId('')
    setSelectedSuburbId('')
    setRegions([])
    setSuburbs([])
    setFetchError(null)
    onSelect(null)
  }, [provinceKey, onSelect])

  async function handleCityChange(cityId: string) {
    setSelectedCityId(cityId)
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
    setSelectedRegionId(regionId)
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

    const suburb = suburbs.find((entry) => entry.id === suburbId)
    if (!suburb) return

    onSelect({
      province: suburb.provinceLabel,
      region: suburb.regionLabel,
      suburb: suburb.label,
      city: suburb.cityLabel,
      postalCode: suburb.postalCode,
      locationNodeId: suburb.id,
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="suburb-picker-city" className="text-sm">
          City / municipality
        </label>
        <select
          id="suburb-picker-city"
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          onChange={(event) => handleCityChange(event.target.value)}
          value={selectedCityId}
        >
          <option value="" disabled>
            Select city…
          </option>
          {filteredCities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.label}
            </option>
          ))}
        </select>
      </div>

      {filteredCities.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No mapped cities are available for this province yet.
        </p>
      )}

      {(regions.length > 0 || loadingRegions) && (
        <div className="space-y-1">
          <label htmlFor="suburb-picker-region" className="text-sm">
            Region / area
          </label>
          <select
            id="suburb-picker-region"
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) => handleRegionChange(event.target.value)}
            value={selectedRegionId}
            disabled={loadingRegions}
          >
            <option value="" disabled>
              {loadingRegions ? 'Loading…' : 'Select area…'}
            </option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {(suburbs.length > 0 || loadingSuburbs) && (
        <div className="space-y-1">
          <label htmlFor="suburb-picker-suburb" className="text-sm">
            Suburb
          </label>
          <select
            id="suburb-picker-suburb"
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) => {
              setSelectedSuburbId(event.target.value)
              handleSuburbChange(event.target.value)
            }}
            value={selectedSuburbId}
            disabled={loadingSuburbs}
          >
            <option value="" disabled>
              {loadingSuburbs ? 'Loading…' : 'Select suburb…'}
            </option>
            {suburbs.map((suburb) => (
              <option key={suburb.id} value={suburb.id}>
                {suburb.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedRegionId && !loadingSuburbs && suburbs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No mapped suburbs are available for this area yet. Choose a different region.
        </p>
      )}

      {fetchError && (
        <p className="text-sm text-destructive" role="alert">
          {fetchError}
        </p>
      )}
    </div>
  )
}
