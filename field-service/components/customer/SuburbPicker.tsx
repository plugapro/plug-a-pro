'use client'

/* eslint-disable react-hooks/set-state-in-effect */

// ─── Suburb search combobox ────────────────────────────────────────────────────
// Replaces the old 4-level cascade (city → region → suburb) with a single
// text input that searches suburb nodes directly. Results are fetched from
// /api/locations/search?mode=suburb, which returns only SUBURB-level nodes
// with all parent labels so the Selection interface can be populated directly.
//
// Props interface is unchanged - callers (BookingFlow) need no modification.

import { useState, useRef, useEffect } from 'react'
import type { SuburbOption } from '@/lib/location-nodes'

export type Selection = {
  province: string
  region: string
  suburb: string
  city: string
  postalCode: string
  locationNodeId: string
}

type Props = {
  provinceKey: string
  onSelect: (selection: Selection | null) => void
}

export function SuburbPicker({ provinceKey, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SuburbOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SuburbOption | null>(null)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  // Clear selection when province changes
  useEffect(() => {
    setQuery('')
    setResults([])
    setSelected(null)
    setOpen(false)
    onSelect(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinceKey])

  async function fetchResults(q: string) {
    if (q.length < 2) {
      setResults([])
      setOpen(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ q, mode: 'suburb' })
      if (provinceKey) params.set('provinceKey', provinceKey)
      const res = await fetch(`/api/locations/search?${params}`)
      if (!res.ok) throw new Error('Search failed')
      const data: SuburbOption[] = await res.json()
      setResults(data)
      setOpen(data.length > 0)
    } catch {
      setError('Could not load suburbs. Please try again.')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setQuery(value)
    setSelected(null)
    onSelect(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchResults(value), 250)
  }

  function handleSelect(suburb: SuburbOption) {
    setSelected(suburb)
    setQuery(suburb.label)
    setOpen(false)
    setResults([])
    onSelect({
      locationNodeId: suburb.id,
      suburb: suburb.label,
      region: suburb.regionLabel,
      city: suburb.cityLabel,
      province: suburb.provinceLabel,
      postalCode: suburb.postalCode,
    })
  }

  function handleBlur(e: React.FocusEvent) {
    // Keep open if focus moves into the results list
    if (listRef.current?.contains(e.relatedTarget as Node)) return
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onBlur={handleBlur}
        onFocus={() => results.length > 0 && !selected && setOpen(true)}
        placeholder="Type your suburb…"
        autoComplete="off"
        role="combobox"
        aria-label="Suburb search"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="suburb-listbox"
        aria-haspopup="listbox"
        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {loading && (
        <span className="absolute right-3 top-2 text-xs text-muted-foreground">Searching…</span>
      )}

      {open && results.length > 0 && (
        <ul
          ref={listRef}
          id="suburb-listbox"
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-background shadow-md"
        >
          {results.map((suburb) => (
            <li key={suburb.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                onMouseDown={(e) => e.preventDefault()} // prevent blur before click
                onClick={() => handleSelect(suburb)}
              >
                <span className="font-medium">{suburb.label}</span>
                <span className="ml-1 text-muted-foreground text-xs">
                  {[suburb.regionLabel, suburb.cityLabel].filter(Boolean).join(', ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">{error}</p>
      )}

      {selected && (
        <p className="mt-1 text-xs text-muted-foreground">
          {[selected.regionLabel, selected.cityLabel, selected.postalCode].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}
