'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CityOption, RegionOption, SuburbOption } from '@/lib/location-nodes'

type Selection = {
  suburb: string
  city: string
  locationNodeId: string | null
}

type Props = {
  initialCities: CityOption[]
  provinceKey: string
  onSelect: (selection: Selection | null) => void
}

export function SuburbPicker({ initialCities, provinceKey, onSelect }: Props) {
  const [selectedCityId, setSelectedCityId] = useState('')
  const [selectedCityLabel, setSelectedCityLabel] = useState('')
  const [selectedRegionId, setSelectedRegionId] = useState('')
  const [selectedSuburbId, setSelectedSuburbId] = useState('')
  const [manualMode, setManualMode] = useState(false)
  const [manualCity, setManualCity] = useState('')
  const [manualSuburb, setManualSuburb] = useState('')
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
    setSelectedCityLabel('')
    setSelectedRegionId('')
    setSelectedSuburbId('')
    setManualMode(false)
    setManualCity('')
    setManualSuburb('')
    setRegions([])
    setSuburbs([])
    setFetchError(null)
    onSelect(null)
  }, [provinceKey, onSelect])

  async function handleCityChange(cityId: string) {
    const city = filteredCities.find((entry) => entry.id === cityId)
    setSelectedCityId(cityId)
    setSelectedCityLabel(city?.label ?? '')
    setSelectedRegionId('')
    setSelectedSuburbId('')
    setRegions([])
    setSuburbs([])
    setManualMode(false)
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
    setManualMode(false)
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
      suburb: suburb.label,
      city: selectedCityLabel,
      locationNodeId: suburb.id,
    })
  }

  function handleManualSelection(nextCity: string, nextSuburb: string) {
    if (!nextCity.trim() || !nextSuburb.trim()) {
      onSelect(null)
      return
    }

    onSelect({
      city: nextCity.trim(),
      suburb: nextSuburb.trim(),
      locationNodeId: null,
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

      {fetchError && (
        <p className="text-sm text-destructive" role="alert">
          {fetchError}
        </p>
      )}

      <div className="space-y-2 rounded-xl border px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Can&apos;t find your suburb?</p>
            <p className="text-xs text-muted-foreground">
              Use manual entry for estates, complexes, informal addresses, or lookup gaps.
            </p>
          </div>
          <button
            type="button"
            className="text-xs font-medium text-primary"
            onClick={() => {
              const nextManualMode = !manualMode
              setManualMode(nextManualMode)
              if (!nextManualMode) {
                setManualCity('')
                setManualSuburb('')
                onSelect(null)
              }
            }}
          >
            {manualMode ? 'Close' : 'Enter manually'}
          </button>
        </div>

        {manualMode && (
          <div className="grid gap-3">
            <input
              type="text"
              value={manualCity}
              onChange={(event) => {
                const nextCity = event.target.value
                setManualCity(nextCity)
                handleManualSelection(nextCity, manualSuburb)
              }}
              placeholder="City / municipality"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <input
              type="text"
              value={manualSuburb}
              onChange={(event) => {
                const nextSuburb = event.target.value
                setManualSuburb(nextSuburb)
                handleManualSelection(manualCity, nextSuburb)
              }}
              placeholder="Suburb / estate / area"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
        )}
      </div>
    </div>
  )
}
