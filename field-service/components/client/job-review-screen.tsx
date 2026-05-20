'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

const TAGS = ['On time', 'Professional', 'Good communication', 'Fair pricing', 'Clean work', 'Would book again']

export function JobReviewScreen({ jobId }: { jobId: string }) {
  const router = useRouter()
  const [rating, setRating] = useState(5)
  const [text, setText] = useState('')
  const [tags, setTags] = useState<string[]>([])

  async function submit() {
    const res = await fetch(`/api/client/reviews/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, tags, text }),
    })
    if (!res.ok) return toast.error('Could not submit review')
    toast.success('Review submitted')
    router.push('/client')
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-6">
      <h1 className="text-2xl font-bold tracking-tight">Leave a review</h1>
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <button key={index} onClick={() => setRating(index + 1)} className={`h-10 w-10 rounded-full border ${rating > index ? 'bg-[var(--color-amber)]' : 'bg-card'} border-border`} />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => setTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))}
            className={`rounded-full px-3 py-2 text-xs font-semibold ${tags.includes(tag) ? 'bg-[var(--tone-brand-bg)] text-[var(--tone-brand-fg)]' : 'bg-card text-[var(--ink)]'} border border-border`}
          >
            {tag}
          </button>
        ))}
      </div>
      <textarea className="mt-4 h-28 w-full rounded-2xl border border-border bg-card p-3 text-sm" value={text} onChange={(event) => setText(event.target.value)} placeholder="Optional comment" />
      <button onClick={submit} className="mt-4 h-12 w-full rounded-2xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)' }}>
        Submit review
      </button>
    </div>
  )
}
