'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { submitReview } from './actions'
import type { ReviewerType } from '@/lib/review-access'
type Props = { matchId: string; reviewerType: ReviewerType; token: string; subjectName: string; jobCategory: string }
export default function ReviewForm({ matchId, reviewerType, token, subjectName, jobCategory }: Props) {
  const router = useRouter()
  const [score, setScore] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (score === 0) { setError('Please select a star rating.'); return }
    setSubmitting(true); setError(null)
    const result = await submitReview({ token, score, comment: comment.trim() || undefined })
    if (result.ok) router.push(`/review/${encodeURIComponent(token)}/thanks`)
    else { setError(result.error ?? 'Something went wrong. Please try again.'); setSubmitting(false) }
  }
  const display = hovered || score
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium">Rate your {jobCategory} job with {subjectName}</p>
        <div className="flex gap-1" onMouseLeave={() => setHovered(0)}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button key={star} type="button" onClick={() => setScore(star)} onMouseEnter={() => setHovered(star)}
              aria-label={`${star} star${star !== 1 ? 's' : ''}`}
              className="text-3xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
              <span className={star <= display ? 'text-yellow-400' : 'text-muted-foreground/30'}>★</span>
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor="comment" className="text-sm font-medium">
          Add a comment <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder="Tell us more about your experience…" rows={4} maxLength={1000} className="resize-none" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={submitting || score === 0}>
        {submitting ? 'Submitting…' : 'Submit review'}
      </Button>
    </form>
  )
}
