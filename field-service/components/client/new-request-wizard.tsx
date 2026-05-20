'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { Stepper } from '@/components/ui/stepper'
import { StepFooter } from '@/components/client/step-footer'
import { toast } from 'sonner'

type Draft = {
  id?: string
  category?: string
  description?: string
  address?: string
  photos: string[]
  schedule?: 'asap' | 'morning' | 'afternoon' | 'specific'
}

const CATEGORIES = ['Plumbing', 'Appliances', 'Handyman', 'Carpentry', 'Painting', 'Cleaning', 'Garden', 'DIY']
const SCHEDULE_OPTIONS: Array<{ id: Draft['schedule']; label: string }> = [
  { id: 'asap', label: 'As soon as possible' },
  { id: 'morning', label: 'Tomorrow morning' },
  { id: 'afternoon', label: 'Tomorrow afternoon' },
  { id: 'specific', label: 'Specific date and time' },
]

export function NewRequestWizard({ resumeId }: { resumeId?: string }) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [draft, setDraft] = useState<Draft>({ id: resumeId, photos: [], schedule: 'asap' })
  const canContinue = useMemo(() => {
    if (step === 1) return Boolean(draft.category && draft.description?.trim())
    if (step === 2) return Boolean(draft.address?.trim())
    return true
  }, [draft, step])

  async function persist(next?: Partial<Draft>) {
    const payload = { ...draft, ...(next ?? {}) }
    const method = payload.id ? 'PATCH' : 'POST'
    const url = payload.id ? `/api/client/requests?id=${encodeURIComponent(payload.id)}` : '/api/client/requests'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('Failed to save draft')
    const data = await res.json()
    setDraft((d) => ({ ...d, ...payload, id: data.id ?? d.id }))
    return data.id as string
  }

  async function onPrimary() {
    try {
      if (step < 5) {
        await persist()
        setStep((s) => s + 1)
        return
      }
      const id = await persist()
      const submit = await fetch(`/api/client/requests/${id}/submit`, { method: 'POST' })
      if (!submit.ok) throw new Error('Failed to submit')
      router.push(`/client/requests/${id}/matching`)
    } catch {
      toast.error('Could not save request right now')
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-36 pt-4">
      <div className="mb-4 flex items-center">
        <button aria-label="Back" onClick={() => (step === 1 ? router.push('/client') : setStep(step - 1))} className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ChevronLeft size={16} />
        </button>
        <span className="ml-auto font-mono text-xs text-[var(--ink-mute)]">Step {step} of 5</span>
      </div>
      <Stepper total={5} current={step - 1} />
      <div className="mt-4">
        {step === 1 ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">What do you need help with?</h1>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {CATEGORIES.map((category) => (
                <button
                  key={category}
                  onClick={() => setDraft((d) => ({ ...d, category }))}
                  className="rounded-2xl border border-border bg-card px-3 py-3 text-left text-sm font-semibold"
                >
                  {category}
                </button>
              ))}
            </div>
            <textarea
              className="mt-3 h-28 w-full rounded-2xl border border-border bg-card p-3 text-sm"
              placeholder="Describe the issue"
              value={draft.description ?? ''}
              onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
            />
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Where should we send the pro?</h1>
            <input
              className="mt-4 h-12 w-full rounded-2xl border border-border bg-card px-3 text-sm"
              placeholder="Address"
              value={draft.address ?? ''}
              onChange={(event) => setDraft((d) => ({ ...d, address: event.target.value }))}
            />
          </>
        ) : null}
        {step === 3 ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Add photos (optional)</h1>
            <p className="mt-1 text-sm text-[var(--ink-mute)]">Upload up to 6 photos to help providers quote faster.</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      photos: current.photos.includes(`photo-${index}`)
                        ? current.photos.filter((item) => item !== `photo-${index}`)
                        : [...current.photos, `photo-${index}`].slice(0, 6),
                    }))
                  }
                  className={`aspect-square rounded-2xl border text-xs ${
                    draft.photos.includes(`photo-${index}`)
                      ? 'border-[var(--brand-purple)] bg-[var(--tone-brand-bg)] text-[var(--tone-brand-fg)]'
                      : 'border-border bg-card text-[var(--ink-mute)]'
                  }`}
                >
                  {draft.photos.includes(`photo-${index}`) ? 'Added' : 'Add'}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {step === 4 ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Choose a time</h1>
            <div className="mt-4 space-y-2">
              {SCHEDULE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, schedule: option.id }))}
                  className={`flex w-full items-center rounded-2xl border px-3 py-3 text-left text-sm font-semibold ${
                    draft.schedule === option.id
                      ? 'border-[var(--brand-purple)] bg-[var(--tone-brand-bg)] text-[var(--tone-brand-fg)]'
                      : 'border-border bg-card text-[var(--ink)]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {step === 5 ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Review and submit</h1>
            <div className="mt-4 space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-mute)]">Category</span>
                <button className="text-xs font-semibold text-[var(--brand-purple)]" onClick={() => setStep(1)} type="button">Edit</button>
              </div>
              <p className="font-semibold">{draft.category ?? 'Not selected'}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[var(--ink-mute)]">Address</span>
                <button className="text-xs font-semibold text-[var(--brand-purple)]" onClick={() => setStep(2)} type="button">Edit</button>
              </div>
              <p className="font-semibold">{draft.address ?? 'Not set'}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[var(--ink-mute)]">Photos</span>
                <button className="text-xs font-semibold text-[var(--brand-purple)]" onClick={() => setStep(3)} type="button">Edit</button>
              </div>
              <p className="font-semibold">{draft.photos.length} attached</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[var(--ink-mute)]">Schedule</span>
                <button className="text-xs font-semibold text-[var(--brand-purple)]" onClick={() => setStep(4)} type="button">Edit</button>
              </div>
              <p className="font-semibold">{SCHEDULE_OPTIONS.find((option) => option.id === draft.schedule)?.label ?? 'As soon as possible'}</p>
            </div>
          </>
        ) : null}
      </div>
      <StepFooter
        primaryLabel={step === 5 ? 'Submit request' : 'Continue'}
        secondaryLabel={step === 3 ? 'Skip' : undefined}
        onSecondary={step === 3 ? () => setStep(4) : undefined}
        onPrimary={onPrimary}
        primaryDisabled={!canContinue}
      />
    </div>
  )
}
