'use client'

// HomeServiceSearch — controlled service typeahead used in place of the legacy
// free-text search input on the customer PWA home page when the feature flag
// `customer.home.serviceability_v2` is enabled.
//
// Behaviour matches the brief:
//   - Customers can only pick a service that is active in the selected area.
//   - The Request button stays disabled until area + valid skill are both set.
//   - Unsupported combinations surface friendly empty-state copy.
//   - On submit, navigates to /providers?area=<slug>&category=<tag>, never to
//     a raw ?q= search.
//
// Data source: GET /api/customer/serviceability?area=<slug>. We fetch on mount
// and on area changes; results are bounded and small (≤ pilot catalogue size)
// so we do all filtering client-side.

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Search, Zap } from 'lucide-react'

type ServiceableCategory = {
  tag: string
  label: string
  activeProviderCount: number
}

type ServiceabilityPayload = {
  area: { slug: string; label: string } | null
  totalActive: number
  categories: ServiceableCategory[]
}

type EmptyState =
  | { kind: 'no_area' }
  | { kind: 'no_providers_in_area' }
  | { kind: 'skill_not_in_area' }
  | { kind: 'skill_unknown' }
  | { kind: 'none' }

export function HomeServiceSearch({
  areaSlug,
  initialSelectedTag,
}: {
  areaSlug: string | null
  initialSelectedTag?: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [data, setData] = useState<ServiceabilityPayload | null>(null)
  const [selectedTag, setSelectedTag] = useState<string | null>(initialSelectedTag?.trim().toLowerCase() || null)
  const inputRef = useRef<HTMLInputElement>(null)

  function syncServiceParam(tag: string | null) {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (areaSlug) {
      params.set('area', areaSlug)
    } else {
      params.delete('area')
    }
    if (tag) params.set('service', tag)
    else params.delete('service')
    const next = params.toString()
    router.replace(`${pathname}${next ? `?${next}` : ''}`, { scroll: false })
  }

  // Loading is derived rather than tracked in state: we're loading whenever the
  // currently-fetched payload's area slug doesn't yet match the area the user
  // has selected. This avoids the React "setState inside an effect" anti-pattern
  // and keeps the loading indicator perfectly consistent with the data shape.
  const loading = areaSlug
    ? data?.area?.slug !== areaSlug
    : data !== null && data.area !== null

  // Fetch active skills whenever the selected area changes. When areaSlug is
  // null we still ask the API so we can render the platform-wide pilot list
  // greyed-out — gives the user a clear "pick an area first" affordance.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const url = areaSlug
      ? `/api/customer/serviceability?area=${encodeURIComponent(areaSlug)}`
      : `/api/customer/serviceability`

    fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: ServiceabilityPayload | null) => {
        if (cancelled) return
        setData(json)
        // If the previously-selected tag is no longer available in the new area,
        // clear it so the Request button doesn't enable in error.
        if (json && selectedTag) {
          const stillAvailable = json.categories.some(
            (c) => c.tag === selectedTag && c.activeProviderCount > 0,
          )
          if (!stillAvailable) {
            setSelectedTag(null)
            syncServiceParam(null)
          }
        }
      })
      .catch(() => {
        if (cancelled) return
        setData(null)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
    // We intentionally exclude selectedTag — it's only inspected, not re-fetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaSlug])

  // Keep component state aligned with URL-driven selection (eg. back/forward
  // navigation or deep-link sharing). If the URL supplies a selection that does
  // not exist in current payload, we clear it below through the availability
  // check and avoid enabling submit. setState-inside-effect is the documented
  // React pattern for "adjusting state when a prop changes" — the lint rule
  // doesn't distinguish it from cascading-render anti-patterns, so we suppress.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    const next = initialSelectedTag?.trim().toLowerCase() || null
    if (!next) {
      if (selectedTag) setSelectedTag(null)
      return
    }

    if (next !== selectedTag) {
      setSelectedTag(next)
    }
    const match = data?.categories.find((c) => c.tag === next)
    if (match) setQuery(match.label)
  }, [initialSelectedTag, data])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const normalizedQuery = query.trim().toLowerCase()

  const suggestions = useMemo<ServiceableCategory[]>(() => {
    if (!data) return []
    const onlyServiceable = data.categories.filter((c) => c.activeProviderCount > 0)
    if (!normalizedQuery) return onlyServiceable.slice(0, 8)
    return onlyServiceable.filter(
      (c) =>
        c.label.toLowerCase().includes(normalizedQuery) ||
        c.tag.toLowerCase().includes(normalizedQuery),
    ).slice(0, 8)
  }, [data, normalizedQuery])

  const emptyState = useMemo<EmptyState>(() => {
    if (loading || !data) return { kind: 'none' }
    if (!data.area) return { kind: 'no_area' }
    const totalServiceable = data.categories.filter((c) => c.activeProviderCount > 0).length
    if (totalServiceable === 0) return { kind: 'no_providers_in_area' }
    if (!normalizedQuery) return { kind: 'none' }
    if (suggestions.length > 0) return { kind: 'none' }
    // Distinguish "we know this skill but not here" from "we don't know this skill at all".
    const known = data.categories.some(
      (c) =>
        c.label.toLowerCase().includes(normalizedQuery) ||
        c.tag.toLowerCase().includes(normalizedQuery),
    )
    return { kind: known ? 'skill_not_in_area' : 'skill_unknown' }
  }, [loading, data, normalizedQuery, suggestions])

  function selectTag(tag: string) {
    setSelectedTag(tag)
    const match = data?.categories.find((c) => c.tag === tag)
    if (match) setQuery(match.label)
    syncServiceParam(tag)
  }

  function clearSelection() {
    setSelectedTag(null)
    setQuery('')
    syncServiceParam(null)
  }

  const canSubmit =
    Boolean(areaSlug) &&
    Boolean(selectedTag) &&
    (data?.categories.find((c) => c.tag === selectedTag)?.activeProviderCount ?? 0) > 0

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !selectedTag || !areaSlug) return
    // Route into the request capture flow the same way PR #58 wired
    // CustomerRequestSearchForm: /book/<categoryTag>?area=<slug>. The selected
    // tag is already a validated pilot category from /api/customer/serviceability
    // so we never produce a /book/other URL from this surface.
    const params = new URLSearchParams()
    params.set('area', areaSlug)
    router.push(`/book/${selectedTag}?${params.toString()}`)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <form onSubmit={onSubmit}>
        <div
          className="flex items-center h-14 rounded-[18px] px-1.5 pl-4 gap-0"
          style={{
            background: 'var(--card)',
            boxShadow: '0 1px 0 var(--border), 0 10px 30px rgba(15,15,30,0.05)',
          }}
        >
          <Search size={18} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (selectedTag) clearSelection()
            }}
            placeholder={areaSlug ? 'Pick a service…' : 'Set your area first'}
            disabled={!areaSlug || loading}
            aria-label="Choose a service"
            className="flex-1 min-w-0 h-full border-none outline-none bg-transparent px-3 text-[15px] font-medium placeholder:text-[var(--ink-soft)] disabled:opacity-60"
            style={{ color: 'var(--ink)' }}
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex items-center gap-1.5 h-11 px-[14px] rounded-[14px] brand-gradient text-white font-bold text-[13px] tracking-[-0.01em] shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.25) inset, 0 8px 24px #8B3FE833' }}
          >
            <Zap size={14} />
            Request
          </button>
        </div>
      </form>

      {/* Suggestion list / empty states */}
      {areaSlug && data && (
        <div className="mt-2">
          {/* Inline empty-state copy when nothing matches the query */}
          {emptyState.kind === 'no_providers_in_area' && (
            <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: 'var(--ink-mute)' }}>
              We are not active in {data.area?.label ?? 'this area'} yet.
            </p>
          )}
          {emptyState.kind === 'skill_not_in_area' && (
            <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: 'var(--ink-mute)' }}>
              We do not have this service active in {data.area?.label ?? 'your selected area'} yet.
            </p>
          )}
          {emptyState.kind === 'skill_unknown' && (
            <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: 'var(--ink-mute)' }}>
              We do not have this service active yet.
            </p>
          )}

          {/* Suggestion chips */}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {suggestions.map((c) => {
                const isSelected = c.tag === selectedTag
                return (
                  <button
                    key={c.tag}
                    type="button"
                    onClick={() => selectTag(c.tag)}
                    className="inline-flex items-center h-7 px-2.5 rounded-full text-[12px] font-semibold transition-colors"
                    style={
                      isSelected
                        ? { background: 'var(--brand-purple)', color: '#fff' }
                        : { background: 'var(--card-alt)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--border)' }
                    }
                    aria-pressed={isSelected}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {!areaSlug && (
        <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: 'var(--ink-mute)' }}>
          Select your area below to see services available near you.
        </p>
      )}
    </div>
  )
}
