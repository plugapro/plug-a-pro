'use client'

import { AuthShell } from '@/components/shared/auth-shell'
import { Button } from '@/components/ui/button'

export default function ProviderVerificationError({ reset }: { error: Error; reset: () => void }) {
  return (
    <AuthShell
      eyebrow="Identity Verification"
      title="Could not load page"
      subtitle="Something went wrong. Please try again."
      backHref="/provider/dashboard"
      dense
    >
      <div className="mx-auto flex w-full max-w-[390px] flex-col gap-4 pb-4">
        <Button type="button" size="lg" onClick={reset}>
          Try again
        </Button>
      </div>
    </AuthShell>
  )
}
