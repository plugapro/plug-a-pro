'use client'

import { useState } from 'react'
import type { CityOption, RegionOption, SuburbOption } from '@/lib/location-nodes'

type Props = {
  initialCities: CityOption[]
  selectedNodeIds: string[]
  selectedLabels: Record<string, string>
}

export function ServiceAreaPicker({ initialCities, selectedNodeIds, selectedLabels }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(selectedNodeIds))
  const [idToLabel, setIdToLabel] = useState<Record<string, string>>(selectedLabels)
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [suburbs, setSuburbs] = useState<SuburbOption[]>([])
  const [loadingRegions, setLoadingRegions] = useState(false)
  const [loadingSuburbs, setLoadingSuburbs] = useState(false)
  const [selectedCityId, setSelectedCityId] = useState('')
  const [selectedRegionId, setSelectedRegionId] = useState('')
  const [fetchError, setFetchError] = useState<string | null>(null)

  async function handleCityChange(cityId: string) {
    setSelectedCityId(cityId)
    setSelectedRegionId('')
    setRegions([])
    setSuburbs([])

    if (!cityId) return

    setLoadingRegions(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/locations/regions?cityId=${encodeURIComponent(cityId)}`)
      if (res.ok) {
        setRegions(await res.json())
      } else {
        setFetchError('Failed to load areas. Please try again.')
        setRegions([])
      }
    } catch {
      setFetchError('Failed to load areas. Please try again.')
      setRegions([])
    } finally {
      setLoadingRegions(false)
    }
  }

  async function handleRegionChange(regionId: string) {
    setSelectedRegionId(regionId)
    setSuburbs([])

    if (!regionId) return

    setLoadingSuburbs(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/locations/suburbs?regionId=${encodeURIComponent(regionId)}`)
      if (res.ok) {
        setSuburbs(await res.json())
      } else {
        setFetchError('Failed to load suburbs. Please try again.')
        setSuburbs([])
      }
    } catch {
      setFetchError('Failed to load suburbs. Please try again.')
      setSuburbs([])
    } finally {
      setLoadingSuburbs(false)
    }
  }

  function handleSuburbToggle(id: string, label: string, checked: boolean) {
    if (checked) {
      setSelectedIds(prev => { const next = new Set(prev); next.add(id); return next })
      setIdToLabel(prev => ({ ...prev, [id]: label }))
    } else {
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  function handleRemove(id: string) {
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
  }

  const selectedArray = Array.from(selectedIds)

  return (
    <div className="space-y-3">
      {/* Sentinel — always present so the server action knows the picker was rendered */}
      <input type="hidden" name="serviceAreasPickerRendered" value="1" />

      {/* Hidden inputs for selected node IDs */}
      {selectedArray.map(nodeId => (
        <input key={nodeId} type="hidden" name="locationNodeIds" value={nodeId} />
      ))}

      {/* City selector */}
      <div className="space-y-1">
        <label htmlFor="area-city-select" className="text-xs text-muted-foreground font-medium">City</label>
        <select
          id="area-city-select"
          value={selectedCityId}
          onChange={e => handleCityChange(e.target.value)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Select a city…</option>
          {initialCities.map(city => (
            <option key={city.id} value={city.id}>{city.label}</option>
          ))}
        </select>
      </div>

      {/* Region selector */}
      {(selectedCityId || regions.length > 0) && (
        <div className="space-y-1">
          <label htmlFor="area-region-select" className="text-xs text-muted-foreground font-medium">Region / area</label>
          <select
            id="area-region-select"
            value={selectedRegionId}
            onChange={e => handleRegionChange(e.target.value)}
            disabled={loadingRegions || regions.length === 0}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">
              {loadingRegions ? 'Loading…' : regions.length === 0 ? 'No regions available' : 'Select a region…'}
            </option>
            {regions.map(region => (
              <option key={region.id} value={region.id}>
                {region.label}{region.suburbCount ? ` (${region.suburbCount})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {fetchError && (
        <p className="text-sm text-destructive" role="alert">{fetchError}</p>
      )}

      {/* Suburb checkboxes */}
      {(selectedRegionId || suburbs.length > 0) && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Suburbs</label>
          {loadingSuburbs ? (
            <p className="text-xs text-muted-foreground py-2">Loading suburbs…</p>
          ) : suburbs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No suburbs available</p>
          ) : (
            <div className="rounded-md border border-input bg-background p-2 max-h-48 overflow-y-auto space-y-1.5">
              {suburbs.map(suburb => (
                <label
                  key={suburb.id}
                  className="flex items-center gap-2 cursor-pointer select-none hover:bg-muted/50 rounded px-1 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(suburb.id)}
                    onChange={e => handleSuburbToggle(suburb.id, suburb.label, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 accent-primary"
                  />
                  <span className="text-sm">{suburb.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected suburbs display */}
      {selectedArray.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Selected suburbs ({selectedArray.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedArray.map(nodeId => (
              <span
                key={nodeId}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {idToLabel[nodeId] ?? nodeId}
                <button
                  type="button"
                  onClick={() => handleRemove(nodeId)}
                  aria-label={`Remove ${idToLabel[nodeId] ?? nodeId}`}
                  className="ml-0.5 hover:text-primary/70 focus:outline-none"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
