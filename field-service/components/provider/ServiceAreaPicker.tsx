'use client'

import { useEffect, useRef, useState } from 'react'
import type { CityOption, NodeSearchResult, RegionOption, SuburbOption } from '@/lib/location-nodes'

type Props = {
  initialCities: CityOption[]
  selectedNodeIds: string[]
  selectedLabels: Record<string, string>
}

export function ServiceAreaPicker({ initialCities, selectedNodeIds, selectedLabels }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(selectedNodeIds))
  const [idToLabel, setIdToLabel] = useState<Record<string, string>>(selectedLabels)

  // ── Cascade state ──────────────────────────────────────────────────────────
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [suburbs, setSuburbs] = useState<SuburbOption[]>([])
  const [loadingRegions, setLoadingRegions] = useState(false)
  const [loadingSuburbs, setLoadingSuburbs] = useState(false)
  const [selectedCityId, setSelectedCityId] = useState('')
  const [selectedRegionId, setSelectedRegionId] = useState('')
  const [cascadeError, setCascadeError] = useState<string | null>(null)

  // ── Search state ───────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NodeSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Cascade handlers ───────────────────────────────────────────────────────

  async function handleCityChange(cityId: string) {
    setSelectedCityId(cityId)
    setSelectedRegionId('')
    setRegions([])
    setSuburbs([])

    if (!cityId) return

    setLoadingRegions(true)
    setCascadeError(null)
    try {
      const res = await fetch(`/api/locations/regions?cityId=${encodeURIComponent(cityId)}`)
      if (res.ok) {
        setRegions(await res.json())
      } else {
        setCascadeError('Failed to load areas. Please try again.')
        setRegions([])
      }
    } catch {
      setCascadeError('Failed to load areas. Please try again.')
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
    setCascadeError(null)
    try {
      const res = await fetch(`/api/locations/suburbs?regionId=${encodeURIComponent(regionId)}`)
      if (res.ok) {
        setSuburbs(await res.json())
      } else {
        setCascadeError('Failed to load suburbs. Please try again.')
        setSuburbs([])
      }
    } catch {
      setCascadeError('Failed to load suburbs. Please try again.')
      setSuburbs([])
    } finally {
      setLoadingSuburbs(false)
    }
  }

  // ── Search handler ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (searchQuery.length < 2) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true)
      setSearchError(null)
      try {
        const res = await fetch(`/api/locations/search?q=${encodeURIComponent(searchQuery)}`)
        if (res.ok) {
          setSearchResults(await res.json())
        } else {
          setSearchError('Search failed. Please try again.')
          setSearchResults([])
        }
      } catch {
        setSearchError('Search failed. Please try again.')
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery])

  // ── Selection helpers ──────────────────────────────────────────────────────

  function handleToggle(id: string, label: string, checked: boolean) {
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
    <div className="space-y-4">
      {/* Sentinel — always present so the server action knows the picker was rendered */}
      <input type="hidden" name="serviceAreasPickerRendered" value="1" />

      {/* Hidden inputs for selected node IDs */}
      {selectedArray.map(nodeId => (
        <input key={nodeId} type="hidden" name="locationNodeIds" value={nodeId} />
      ))}

      {/* ── Search ───────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label htmlFor="area-search-input" className="text-xs text-muted-foreground font-medium">
          Search suburbs
        </label>
        <input
          id="area-search-input"
          type="search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Type a suburb or area name…"
          autoComplete="off"
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {searchLoading && (
          <p className="text-xs text-muted-foreground">Searching…</p>
        )}
        {searchError && (
          <p className="text-xs text-destructive" role="alert">{searchError}</p>
        )}
        {searchResults.length > 0 && (
          <div className="rounded-md border border-input bg-background p-2 max-h-48 overflow-y-auto space-y-1.5">
            {searchResults.map(result => (
              <label
                key={result.id}
                className="flex items-center gap-2 cursor-pointer select-none hover:bg-muted/50 rounded px-1 py-0.5"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(result.id)}
                  onChange={e => handleToggle(result.id, result.label, e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-sm">{result.label}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {result.nodeType === 'SUBURB' ? 'Suburb' : 'Region'}
                </span>
              </label>
            ))}
          </div>
        )}
        {searchQuery.length >= 2 && !searchLoading && searchResults.length === 0 && !searchError && (
          <p className="text-xs text-muted-foreground">No results for &ldquo;{searchQuery}&rdquo;</p>
        )}
      </div>

      <div className="relative flex items-center">
        <div className="flex-1 border-t border-border" />
        <span className="mx-3 text-xs text-muted-foreground">or browse by area</span>
        <div className="flex-1 border-t border-border" />
      </div>

      {/* ── Cascade ──────────────────────────────────────────────────────── */}
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

      {cascadeError && (
        <p className="text-sm text-destructive" role="alert">{cascadeError}</p>
      )}

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
                    onChange={e => handleToggle(suburb.id, suburb.label, e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <span className="text-sm">{suburb.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Selected suburbs display ──────────────────────────────────────── */}
      {selectedArray.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Selected ({selectedArray.length})</p>
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
