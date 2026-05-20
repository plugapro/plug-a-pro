import Link from 'next/link'
import { Calendar, ChevronRight, Plus, Wrench } from 'lucide-react'
import { StatusPill } from '@/components/ui/status-pill'

type HomeRequest = { id: string; title: string; status: string; subtitle?: string | null }
type HomeJob = { id: string; title: string; status: string; subtitle?: string | null }

export function ClientHomeScreen({
  name,
  requests,
  jobs,
}: {
  name?: string | null
  requests: HomeRequest[]
  jobs: HomeJob[]
}) {
  return (
    <div className="mx-auto max-w-md px-5 pb-24 pt-6">
      <p className="text-[22px] font-bold tracking-tight">Hi {name?.split(' ')[0] ?? 'there'}</p>
      <p className="mt-1 text-sm text-[var(--ink-mute)]">Need a pro for something? Tell us what&apos;s up.</p>

      <Link
        href="/client/new-request"
        className="mt-4 flex items-center gap-3 rounded-[24px] px-5 py-5 text-white shadow-[0_12px_30px_rgba(139,63,232,.2)]"
        style={{ background: 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)' }}
      >
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/20">
          <Plus size={20} />
        </span>
        <span className="flex-1">
          <span className="block text-base font-bold">New request</span>
          <span className="block text-xs opacity-90">We&apos;ll match you with up to 3 pros</span>
        </span>
        <ChevronRight size={18} />
      </Link>

      <section className="mt-6 space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-mute)]">In progress</p>
        {requests.length === 0 && jobs.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-4 text-sm text-[var(--ink-mute)]">No active requests yet.</div>
        ) : null}
        {requests.map((request) => (
          <Link key={request.id} href={`/client/requests/${request.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--tone-brand-bg)] text-[var(--tone-brand-fg)]"><Wrench size={16} /></span>
            <span className="min-w-0 flex-1">
              <StatusPill tone={request.status === 'SHORTLIST_READY' ? 'warn' : 'brand'}>
                {request.status.replaceAll('_', ' ').toLowerCase()}
              </StatusPill>
              <span className="mt-1 block truncate text-sm font-semibold">{request.title}</span>
              {request.subtitle ? <span className="block text-xs text-[var(--ink-mute)]">{request.subtitle}</span> : null}
            </span>
            <ChevronRight size={16} className="text-[var(--ink-mute)]" />
          </Link>
        ))}
        {jobs.map((job) => (
          <Link key={job.id} href={`/client/jobs/${job.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]"><Calendar size={16} /></span>
            <span className="min-w-0 flex-1">
              <StatusPill tone={job.status === 'COMPLETED' ? 'success' : 'brand'}>
                {job.status.replaceAll('_', ' ').toLowerCase()}
              </StatusPill>
              <span className="mt-1 block truncate text-sm font-semibold">{job.title}</span>
              {job.subtitle ? <span className="block text-xs text-[var(--ink-mute)]">{job.subtitle}</span> : null}
            </span>
            <ChevronRight size={16} className="text-[var(--ink-mute)]" />
          </Link>
        ))}
      </section>

      <Link href="/client/legal" className="mt-6 inline-block text-sm font-semibold text-[var(--brand-purple)]">
        Legal & policies
      </Link>
    </div>
  )
}

