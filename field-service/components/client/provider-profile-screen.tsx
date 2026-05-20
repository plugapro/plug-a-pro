'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type ProviderProfileData = {
  bio: string | null
  experience: string | null
  skills: string[]
  serviceAreas: string[]
  verified: boolean
  averageRating: number | null
  completedJobsCount: number | null
  callOutFee: number | null
  estimatedArrivalAt: string | null
  negotiable: boolean
  providerNote: string | null
}

export function ProviderProfileScreen({
  requestId,
  providerId,
  providerName,
  profile,
}: {
  requestId: string
  providerId: string
  providerName: string
  profile: ProviderProfileData
}) {
  const router = useRouter()

  async function selectProvider() {
    const res = await fetch(`/api/client/requests/${requestId}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId }),
    })
    if (!res.ok) {
      toast.error('Could not select provider')
      return
    }
    router.push(`/client/requests/${requestId}/selected`)
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-6">
      <h1 className="text-2xl font-bold tracking-tight">{providerName}</h1>
      <p className="mt-1 text-sm text-[var(--ink-mute)]">
        {profile.verified ? 'Verified provider profile' : 'Provider profile'}
      </p>

      <div className="mt-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="font-semibold">
            {profile.averageRating != null ? `${profile.averageRating.toFixed(1)}★` : 'New provider'}
          </p>
          <p className="text-[var(--ink-mute)]">
            {profile.completedJobsCount != null ? `${profile.completedJobsCount} completed jobs` : 'Building history'}
          </p>
        </div>
        {profile.callOutFee != null ? (
          <p className="mt-2 text-sm">Call-out fee from R{profile.callOutFee.toFixed(0)}</p>
        ) : null}
        {profile.estimatedArrivalAt ? (
          <p className="mt-1 text-sm text-[var(--ink-mute)]">
            Earliest arrival: {new Date(profile.estimatedArrivalAt).toLocaleString('en-ZA')}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-[var(--ink-mute)]">
          {profile.negotiable ? 'Rates may be negotiable.' : 'Rates are fixed for this response.'}
        </p>
      </div>

      {profile.bio ? (
        <div className="mt-3 rounded-2xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold">About</p>
          <p className="mt-1 text-[var(--ink-mute)]">{profile.bio}</p>
        </div>
      ) : null}

      {profile.skills.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold">Services</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {profile.skills.map((skill) => (
              <span key={skill} className="rounded-full bg-[var(--tone-brand-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--tone-brand-fg)]">
                {skill}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {profile.serviceAreas.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold">Areas served</p>
          <p className="mt-1 text-[var(--ink-mute)]">{profile.serviceAreas.join(', ')}</p>
        </div>
      ) : null}

      {profile.providerNote ? (
        <div className="mt-3 rounded-2xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold">Provider note</p>
          <p className="mt-1 text-[var(--ink-mute)]">{profile.providerNote}</p>
        </div>
      ) : null}

      <div className="mt-3 rounded-2xl border border-border bg-card p-4 text-sm text-[var(--ink-mute)]">
        Your exact address and phone number are only shared after you select a provider and they accept the job.
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-[rgba(246,246,248,0.92)] px-5 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur-xl dark:bg-[rgba(11,11,16,0.92)]">
        <button
          onClick={selectProvider}
          className="mx-auto block w-full max-w-md rounded-2xl px-4 py-3 text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)' }}
        >
          Select {providerName}
        </button>
      </div>
    </div>
  )
}
