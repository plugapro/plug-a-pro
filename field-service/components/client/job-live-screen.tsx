'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

type Extra = { id: string; description: string; amount: number; status: string }
type LiveStatus = { status: string; etaMins: number | null; extras: Extra[] }

export function JobLiveScreen({ jobId, initialStatus }: { jobId: string; initialStatus: LiveStatus }) {
  const [status, setStatus] = useState(initialStatus)
  const [activeExtraId, setActiveExtraId] = useState<string | null>(null)
  const activeExtra = useMemo(
    () => status.extras.find((extra) => extra.id === activeExtraId && extra.status === 'PENDING') ?? null,
    [activeExtraId, status.extras],
  )

  useEffect(() => {
    const shouldPoll = status.status === 'EN_ROUTE' || status.status === 'STARTED'
    if (!shouldPoll) return
    const timer = setInterval(async () => {
      const res = await fetch(`/api/client/jobs/${jobId}/status`, { cache: 'no-store' })
      if (!res.ok) return
      const next = (await res.json()) as LiveStatus
      if (activeExtraId && !next.extras.some((item) => item.id === activeExtraId && item.status === 'PENDING')) {
        setActiveExtraId(null)
        toast.message('Extra work state changed')
      }
      setStatus(next)
    }, 15000)
    return () => clearInterval(timer)
  }, [activeExtraId, jobId, status.status])

  async function resolveExtra(accepted: boolean) {
    if (!activeExtra) return
    const res = await fetch(`/api/client/jobs/${jobId}/extra-work`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extraWorkId: activeExtra.id, accepted }),
    })
    if (!res.ok) return toast.error('Could not update extra work')
    setActiveExtraId(null)
    toast.success(accepted ? 'Extra work approved' : 'Extra work declined')
  }

  return (
    <div className="mx-auto max-w-md px-5 py-6 [animation:pap-fade-in_.2s_ease-out_both]">
      <h1 className="text-2xl font-bold tracking-tight">Track job</h1>
      <div className="mt-4 h-56 rounded-3xl border border-border bg-card p-3">
        <div className="relative h-full w-full rounded-2xl bg-[linear-gradient(180deg,#edf3ff,#dbe8ff)]">
          <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-xs font-mono shadow">
            <span className="h-2 w-2 rounded-full bg-[var(--brand-pink)] [animation:pap-pulse-dot_1.4s_ease-in-out_infinite]" />
            ETA {status.etaMins ?? '--'} min
          </div>
          <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--brand-pink)] shadow-[0_0_0_12px_rgba(255,31,142,.2)] [animation:pap-pulse-dot_1.6s_ease-in-out_infinite]" />
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm">
        Status: <span className="font-semibold">{status.status}</span>
      </div>
      <div className="mt-3 rounded-2xl border border-border bg-card p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-mute)]">Timeline</p>
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex items-start gap-3"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--success)]" /><span>Provider accepted your request</span></div>
          <div className="flex items-start gap-3"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--success)]" /><span>Quote approved</span></div>
          <div className="flex items-start gap-3"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--brand-purple)] [animation:pap-pulse-dot_1.4s_ease-in-out_infinite]" /><span>Provider en route</span></div>
          <div className="flex items-start gap-3 text-[var(--ink-mute)]"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-border" /><span>Arrival</span></div>
        </div>
      </div>
      {status.extras.filter((extra) => extra.status === 'PENDING').map((extra) => (
        <button key={extra.id} onClick={() => setActiveExtraId(extra.id)} className="mt-3 w-full rounded-2xl border border-border bg-card p-4 text-left text-sm">
          Extra work requested: {extra.description} (R{Number(extra.amount).toFixed(2)})
        </button>
      ))}
      {activeExtra ? (
        <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-3xl border-t border-border bg-card px-5 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-4 [animation:pap-sheet-up_.22s_ease-out_both]">
          <div className="mx-auto h-1 w-10 rounded-full bg-border" />
          <p className="mt-4 text-sm font-semibold">{activeExtra.description}</p>
          <p className="text-xl font-bold">R{Number(activeExtra.amount).toFixed(2)}</p>
          <p className="mt-2 text-xs text-[var(--ink-mute)]">You can also approve from WhatsApp.</p>
          <div className="mt-4 flex gap-3">
            <button onClick={() => resolveExtra(false)} className="h-11 flex-1 rounded-xl border border-border bg-card text-sm font-semibold">Decline</button>
            <button onClick={() => resolveExtra(true)} className="h-11 flex-1 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)' }}>Approve</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
