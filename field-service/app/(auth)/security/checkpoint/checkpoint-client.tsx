'use client'

import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/shared/auth-shell'

type StepUpAckPayload = {
  ok?: boolean
  restartSignIn?: boolean
}

export function CheckpointClient() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const response = await fetch('/api/security/otp/step-up/ack', {
        method: 'POST',
      })
      const payload = await response.json().catch(() => ({})) as StepUpAckPayload

      if (response.ok && payload.ok) {
        router.replace('/')
        return
      }

      if (payload.restartSignIn) {
        router.replace('/login')
        return
      }

      setError('Could not continue. Please sign in again.')
    } catch {
      setError('Could not continue. Please sign in again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Security checkpoint"
      title="Secure your account"
      subtitle="Confirm this was you to continue."
      backHref="/login"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
        <div className="mx-auto flex size-12 items-center justify-center rounded-[16px] bg-[var(--card-alt)] text-[var(--brand-purple)]">
          <ShieldCheck size={22} aria-hidden="true" />
        </div>

        {error ? (
          <p className="text-center text-[13px] font-medium text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <Button type="submit" fullWidth size="md" loading={loading}>
          Secure my account &amp; continue
        </Button>
      </form>
    </AuthShell>
  )
}
