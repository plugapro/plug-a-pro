'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Zap } from 'lucide-react'
import { buildCustomerRequestUrl } from '@/lib/customer-search-routing'

type CustomerRequestSearchFormProps = {
  currentArea?: string | null
}

export function CustomerRequestSearchForm({ currentArea }: CustomerRequestSearchFormProps) {
  const router = useRouter()
  const [searchTerm, setSearchTerm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const trimmedSearchTerm = searchTerm.trim()
    if (!trimmedSearchTerm) {
      setError('Enter the service you need, or choose a category below.')
      return
    }

    try {
      const nextUrl = buildCustomerRequestUrl({
        searchTerm: trimmedSearchTerm,
        area: currentArea,
      })
      if (!nextUrl) {
        setError('Enter the service you need, or choose a category below.')
        return
      }

      setError(null)
      setSubmitting(true)
      router.push(nextUrl)
    } catch (err) {
      console.error('[customer-search] request handoff failed', err)
      setSubmitting(false)
      setError('We could not open the request form. Please try again.')
    }
  }

  return (
    <form action="/providers" method="get" onSubmit={handleSubmit} data-customer-request-search>
      {currentArea && <input type="hidden" name="area" value={currentArea} />}
      <div
        className="flex items-center h-14 rounded-[18px] px-1.5 pl-4 gap-0"
        style={{
          background: 'var(--card)',
          boxShadow: '0 1px 0 var(--border), 0 10px 30px rgba(15,15,30,0.05)',
        }}
      >
        <Search size={18} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
        <input
          name="q"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Handyman, tiler, plumber..."
          className="flex-1 min-w-0 h-full border-none outline-none bg-transparent px-3 text-[15px] font-medium placeholder:text-[var(--ink-soft)]"
          style={{ color: 'var(--ink)' }}
          disabled={submitting}
          aria-describedby={error ? 'customer-request-search-error' : undefined}
        />
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="flex items-center gap-1.5 h-11 px-[14px] rounded-[14px] brand-gradient text-white font-bold text-[13px] tracking-[-0.01em] shrink-0 disabled:opacity-70 disabled:pointer-events-none"
          style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.25) inset, 0 8px 24px #8B3FE833' }}
        >
          <Zap size={14} />
          {submitting ? 'Opening...' : 'Request'}
        </button>
      </div>
      {error && (
        <p
          id="customer-request-search-error"
          role="alert"
          className="mt-2 text-[12.5px] font-medium"
          style={{ color: '#E5484D' }}
        >
          {error}
        </p>
      )}
    </form>
  )
}
