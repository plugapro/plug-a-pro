import Link from 'next/link'
import { Bell, Calendar, Check, ChevronRight, Plus, Search, Wrench } from 'lucide-react'
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
    <div className="mx-auto max-w-md pb-24 pt-4 [animation:pap-fade-in_.2s_ease-out_both]">
      <div className="flex items-center gap-2 px-5 pb-1 pt-1">
        <div className="grid h-8 w-8 place-items-center rounded-xl brand-gradient text-white">P</div>
        <p className="text-[14px] font-extrabold tracking-[0.03em]">Plug A Pro</p>
        <div className="ml-auto grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-[var(--ink)]">
          <Bell size={16} />
        </div>
      </div>
      <div className="px-5 pb-4 pt-2">
        <p className="text-[26px] font-bold leading-[1.08] tracking-tight">
          Hi {name?.split(' ')[0] ?? 'there'}<br />
          what needs fixing?
        </p>
        <p className="mt-2 text-[14px] text-[var(--ink-mute)]">
          Handymen, plumbers, gardeners, tilers and more.
        </p>
      </div>

      <Link
        href="/client/new-request"
        className="mx-5 mt-1 flex items-center gap-3 rounded-[24px] px-5 py-5 text-white shadow-[0_12px_30px_rgba(139,63,232,.2)]"
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

      <div className="mx-5 mt-3 rounded-[18px] border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Search size={15} className="text-[var(--ink-mute)]" />
          <p className="text-[13px] text-[var(--ink-soft)]">Handyman, tiler, plumber…</p>
        </div>
      </div>

      <section className="mt-6 space-y-2 px-5">
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

      <div className="mt-4 px-5">
        <div className="flex items-center gap-3 rounded-2xl bg-[rgba(37,211,102,0.08)] px-3 py-3">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-whatsapp)] text-white">W</div>
          <div>
            <p className="text-[13px] font-semibold">We&apos;ll WhatsApp you</p>
            <p className="text-[12px] text-[var(--ink-mute)]">Updates come to your verified number</p>
          </div>
        </div>
      </div>

      <section className="mt-6 px-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-mute)]">Recent</p>
          <Link href="/client/legal" className="text-xs font-semibold text-[var(--brand-purple)]">Legal & policies</Link>
        </div>
        <div className="rounded-2xl border border-border bg-card px-4">
          {jobs.slice(0, 3).map((job, index) => (
            <Link key={job.id} href={`/client/jobs/${job.id}`} className={`flex items-center gap-3 py-3 ${index > 0 ? 'border-t border-border' : ''}`}>
              <div className="grid h-8 w-8 place-items-center rounded-full bg-[var(--card-alt)] text-[var(--ink-mute)]">
                <Check size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{job.title}</p>
                <p className="text-xs text-[var(--ink-mute)]">Completed</p>
              </div>
              <p className="font-mono text-xs">{job.status}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
