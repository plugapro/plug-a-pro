'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export function ProviderProfileScreen({
  requestId,
  providerId,
  providerName,
}: {
  requestId: string
  providerId: string
  providerName: string
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
      <p className="mt-1 text-sm text-[var(--ink-mute)]">Verified provider profile</p>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm text-[var(--ink-mute)]">
        Full customer address is only shared after you select a provider and they confirm.
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

