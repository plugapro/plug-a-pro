'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, ChevronDown, X, Search } from 'lucide-react'

const STORAGE_KEY = 'pap-area'

type AreaOption = { slug: string; label: string }

interface AreaSelectorProps {
  currentArea?: string
}

export function AreaSelector({ currentArea }: AreaSelectorProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AreaOption[]>([])
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed: AreaOption = JSON.parse(stored)
        setSelectedLabel(parsed.label)
        if (!currentArea) {
          router.replace(`/?area=${encodeURIComponent(parsed.slug)}`)
        }
      }
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchResults = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return }
    const controller = new AbortController()
    fetch(`/api/locations/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then(r => r.json())
      .then((data: AreaOption[]) => setResults(data.map(n => ({ slug: n.slug, label: n.label }))))
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchResults(query), 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, fetchResults])

  function openSheet() {
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 80)
  }

  function closeSheet() {
    setOpen(false)
    setQuery('')
    setResults([])
  }

  function select(area: AreaOption) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(area)) } catch {}
    setSelectedLabel(area.label)
    closeSheet()
    router.push(`/?area=${encodeURIComponent(area.slug)}`)
  }

  function clear() {
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
    setSelectedLabel(null)
    closeSheet()
    router.push('/')
  }

  const displayLabel = selectedLabel ?? currentArea ?? null

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-full text-[12.5px] font-semibold press-feedback"
        style={{ background: 'var(--card-alt)', color: 'var(--ink)' }}
        aria-label={displayLabel ? `Change area: ${displayLabel}` : 'Set your area'}
      >
        <MapPin size={14} style={{ color: 'var(--brand-purple)', flexShrink: 0 }} />
        <span className="max-w-[130px] truncate">{displayLabel ?? 'Near you'}</span>
        <ChevronDown size={13} style={{ color: 'var(--ink-mute)' }} />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            onClick={closeSheet}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Set your area"
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-[28px] px-5 pt-4"
            style={{
              background: 'var(--card)',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
              maxHeight: '72dvh',
              paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
            }}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--border)' }} aria-hidden />

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[18px] font-bold tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
                Set your area
              </h2>
              <button
                type="button"
                onClick={closeSheet}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'var(--card-alt)' }}
                aria-label="Close"
              >
                <X size={15} style={{ color: 'var(--ink-mute)' }} />
              </button>
            </div>

            <div className="relative mb-3">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--ink-mute)' }} />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search suburb or city…"
                className="w-full h-[46px] pl-10 pr-4 rounded-[14px] text-[14px] outline-none"
                style={{
                  background: 'var(--card-alt)',
                  color: 'var(--ink)',
                  boxShadow: 'inset 0 0 0 1px var(--border)',
                }}
              />
            </div>

            <div className="overflow-y-auto flex-1 -mx-1 px-1">
              {query.length < 2 ? (
                <p className="text-[13px] text-center py-8" style={{ color: 'var(--ink-mute)' }}>
                  Type a suburb or city name to search
                </p>
              ) : results.length === 0 ? (
                <p className="text-[13px] text-center py-8" style={{ color: 'var(--ink-mute)' }}>
                  No areas found for &ldquo;{query}&rdquo;
                </p>
              ) : (
                results.map(r => (
                  <button
                    key={r.slug}
                    type="button"
                    onClick={() => select(r)}
                    className="w-full text-left flex items-center gap-3 px-3 py-3.5 rounded-[14px] transition-colors hover:bg-[var(--card-alt)]"
                    style={{ color: 'var(--ink)' }}
                  >
                    <MapPin size={15} style={{ color: 'var(--brand-purple)', flexShrink: 0 }} />
                    <span className="text-[14px] font-medium">{r.label}</span>
                  </button>
                ))
              )}

              {displayLabel && (
                <button
                  type="button"
                  onClick={clear}
                  className="w-full text-center text-[13px] font-semibold py-4 mt-2"
                  style={{ color: 'var(--brand-purple)' }}
                >
                  Clear — show all areas
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
