// Provider lead board: pull surface for job requests whose push offers all
// lapsed. Flag-gated (provider.board.v1). Cards render ONLY BoardJob fields -
// the type physically cannot carry customer identity, phone, street address
// or access notes, which is the privacy enforcement (no allowlisting needed
// here in the page).
// Spec: docs/superpowers/specs/2026-07-21-provider-lead-board-design.md §1.
export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { Inbox } from 'lucide-react'
import { requireProvider } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { findBoardJobsForProvider } from '@/lib/board/eligibility'
import { BoardJobCard, type BoardJobCardData } from './BoardJobCard'

export const metadata = buildMetadata({ title: 'Job Board', noIndex: true })

export default async function ProviderBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[]; q?: string | string[] }>
}) {
  if (!(await isEnabled('provider.board.v1'))) notFound()

  const session = await requireProvider()
  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true, skills: true },
  })

  if (!provider) {
    return (
      <div className="px-[18px] pt-[60px] pb-10 text-center">
        <p className="text-[14px] text-[var(--ink-mute)]">Provider account not set up. Contact support.</p>
      </div>
    )
  }

  const params = await searchParams
  const category = typeof params.category === 'string' ? params.category : undefined
  const suburbQuery = typeof params.q === 'string' ? params.q : undefined

  const jobs = await findBoardJobsForProvider(db, provider.id, { category, suburbQuery })
  const skills = provider.skills ?? []

  const jobCards: BoardJobCardData[] = jobs.map((job) => ({
    id: job.id,
    category: job.category,
    title: job.title,
    description: job.description,
    suburbLabel: job.suburbLabel,
    requestedWindowStart: job.requestedWindowStart ? job.requestedWindowStart.toISOString() : null,
    requestedWindowEnd: job.requestedWindowEnd ? job.requestedWindowEnd.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
    interestCount: job.interestCount,
  }))

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--brand-purple)] mb-1">
          Job board
        </p>
        <h1 className="text-[28px] font-bold tracking-[-0.025em] leading-[1.1] text-[var(--ink)]">
          Jobs open in your area
        </h1>
        <p className="mt-1.5 text-[14px] text-[var(--ink-mute)]">
          {jobCards.length === 0
            ? 'No open jobs match your area and skills right now - check back soon.'
            : `${jobCards.length} ${jobCards.length === 1 ? 'job' : 'jobs'} you can put your hand up for.`}
        </p>
      </div>

      {/* Filters */}
      <div className="px-[18px] mb-4">
        <form method="GET" className="flex gap-2">
          <select
            name="category"
            defaultValue={category ?? ''}
            className="h-[42px] rounded-[12px] bg-card px-3 text-[13.5px] shadow-[inset_0_0_0_1px_var(--border)] outline-none"
          >
            <option value="">All your skills</option>
            {skills.map((skill) => (
              <option key={skill} value={skill}>
                {skill.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <input
            type="text"
            name="q"
            defaultValue={suburbQuery ?? ''}
            placeholder="Search suburb"
            className="h-[42px] flex-1 rounded-[12px] bg-card px-3 text-[13.5px] shadow-[inset_0_0_0_1px_var(--border)] outline-none placeholder:text-[var(--ink-soft)]"
          />
          <button
            type="submit"
            className="h-[42px] px-4 rounded-[12px] text-[13.5px] font-semibold text-white"
            style={{ background: 'var(--brand-purple)' }}
          >
            Search
          </button>
        </form>
      </div>

      <div className="px-[18px]">
        {jobCards.length === 0 ? (
          <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-8 text-center">
            <div className="w-14 h-14 rounded-[18px] brand-gradient-soft flex items-center justify-center mx-auto mb-4">
              <Inbox size={26} className="text-[var(--brand-purple)]" />
            </div>
            <p className="text-[15px] font-bold text-[var(--ink)] tracking-[-0.01em] mb-2">No open jobs right now</p>
            <p className="text-[13.5px] text-[var(--ink-mute)] max-w-[260px] mx-auto leading-relaxed">
              Jobs land here once a customer&apos;s push offers to other providers lapse. Check back soon.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobCards.map((job) => (
              <BoardJobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
