'use client'

// Provider lead board: one job card + its "I'm interested" affordance.
// Renders ONLY the fields the BoardJob type carries - no customer identity,
// phone, street address or access notes ever reach this component, because
// the server query (lib/board/eligibility.ts) never selects them.
import { useState, useTransition } from 'react'
import { MapPin, Clock3, Users } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { Button } from '@/components/ui/button'
import { AlertCallout } from '@/components/shared/AlertCallout'
import { expressInterestAction } from './actions'
import type { BoardInterestResult } from '@/lib/board/interest'

export type BoardJobCardData = {
  id: string
  category: string
  title: string | null
  description: string | null
  suburbLabel: string | null
  requestedWindowStart: string | null
  requestedWindowEnd: string | null
  createdAt: string
  interestCount: number
}

const FAILURE_COPY: Record<Exclude<BoardInterestResult, { ok: true }>['reason'], string> = {
  FLAG_OFF: 'The job board is currently unavailable.',
  NOT_ELIGIBLE_PROVIDER: "This job isn't available to your provider account right now.",
  JOB_GONE: 'This job is no longer available.',
  SHORTLIST_FULL: "This job's shortlist just filled up.",
  ALREADY_INTERESTED: "You've already raised your hand for this one.",
  INVALID_INPUT: 'Check your call-out fee and arrival time and try again.',
  INTEREST_RECORD_FAILED: 'Something went wrong saving your interest — please try again in a minute.',
}

function requestedWindowLabel(start: string | null, end: string | null): string {
  if (!start && !end) return 'Flexible timing'
  if (start && end) {
    return `${new Date(start).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} – ${new Date(end).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`
  }
  const d = new Date((start ?? end) as string)
  return d.toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function BoardJobCard({ job }: { job: BoardJobCardData }) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<BoardInterestResult | null>(null)
  const [isPending, startTransition] = useTransition()

  const postedAgo = formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })
  const alreadyInterested = result?.ok === false && result.reason === 'ALREADY_INTERESTED'
  const succeeded = result?.ok === true

  async function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await expressInterestAction(formData)
      setResult(res)
      if (res.ok) setOpen(false)
    })
  }

  return (
    <div className="bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <p className="text-[15px] font-bold text-[var(--ink)] tracking-[-0.015em] capitalize">
            {job.category.replaceAll('_', ' ')}
          </p>
          <span className="flex items-center gap-1 text-[12px] font-semibold text-[var(--ink-mute)] shrink-0">
            <Users size={12} />
            {job.interestCount}/3 interested
          </span>
        </div>

        {job.title && (
          <p className="text-[13.5px] font-semibold text-[var(--ink)] mb-1">{job.title}</p>
        )}

        {job.suburbLabel && (
          <p className="flex items-center gap-1 text-[13px] text-[var(--ink-mute)] mb-2">
            <MapPin size={13} />
            {job.suburbLabel}
          </p>
        )}

        {job.description && (
          <p className="text-[13px] text-[var(--ink-mute)] line-clamp-2 mb-3">
            {job.description}
          </p>
        )}

        <div className="border-t border-[var(--border)] pt-3 flex items-center justify-between mb-1">
          <span className="flex items-center gap-1 text-[12.5px] font-semibold text-[var(--brand-purple)]">
            <Clock3 size={13} />
            {requestedWindowLabel(job.requestedWindowStart, job.requestedWindowEnd)}
          </span>
          <span className="text-[12px] text-[var(--ink-soft)]">Posted {postedAgo}</span>
        </div>

        {result && !succeeded && (
          <AlertCallout tone={alreadyInterested ? 'neutral' : 'warning'} className="mt-3">
            {FAILURE_COPY[result.reason]}
          </AlertCallout>
        )}

        {succeeded && (
          <AlertCallout tone="success" className="mt-3">
            You&apos;re on the shortlist for this job. We&apos;ll notify the customer.
          </AlertCallout>
        )}

        {!succeeded && !alreadyInterested && (
          <div className="mt-3">
            {!open ? (
              <Button size="sm" className="w-full" onClick={() => setOpen(true)}>
                I&apos;m interested
              </Button>
            ) : (
              <form action={handleSubmit} className="space-y-2.5">
                <input type="hidden" name="jobRequestId" value={job.id} />
                <div>
                  <label htmlFor={`callOutFee-${job.id}`} className="text-[12px] font-semibold text-[var(--ink-mute)]">
                    Call-out fee (ZAR)
                  </label>
                  <input
                    id={`callOutFee-${job.id}`}
                    name="callOutFee"
                    type="number"
                    min="0"
                    step="1"
                    required
                    className="mt-1 h-[42px] w-full rounded-[12px] bg-card px-3 text-[14px] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand-purple)]"
                  />
                </div>
                <div>
                  <label htmlFor={`arrival-${job.id}`} className="text-[12px] font-semibold text-[var(--ink-mute)]">
                    Earliest arrival
                  </label>
                  <input
                    id={`arrival-${job.id}`}
                    name="estimatedArrivalAt"
                    type="datetime-local"
                    required
                    className="mt-1 h-[42px] w-full rounded-[12px] bg-card px-3 text-[14px] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand-purple)]"
                  />
                </div>
                <div>
                  <label htmlFor={`note-${job.id}`} className="text-[12px] font-semibold text-[var(--ink-mute)]">
                    Note to customer (optional)
                  </label>
                  <textarea
                    id={`note-${job.id}`}
                    name="note"
                    rows={2}
                    maxLength={500}
                    className="mt-1 w-full rounded-[12px] bg-card px-3 py-2 text-[14px] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand-purple)]"
                  />
                </div>
                <div className="flex gap-2">
                  <FormSubmitButton
                    size="sm"
                    className="flex-1"
                    pendingLabel="Sending..."
                    disabled={isPending}
                  >
                    Send interest
                  </FormSubmitButton>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setOpen(false)}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
