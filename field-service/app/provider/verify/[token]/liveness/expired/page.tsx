import { redirect } from 'next/navigation'
import { submitVerificationForAutomation } from '@/lib/identity-verification/orchestrator'
import { resolveProviderVerificationToken } from '@/lib/provider-verification-token'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function ExpiredLivenessPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  async function requestNewLivenessLinkAction() {
    'use server'
    const verification = await resolveProviderVerificationToken(token)
    await submitVerificationForAutomation(verification.id, db, {
      existingToken: token,
      refreshExpiredLiveness: true,
    })
    redirect(`/provider/verify/${encodeURIComponent(token)}`)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8">
      <div className="rounded-lg border bg-card p-4">
        <h1 className="text-xl font-semibold">Face-match session expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your secure face-match session has expired. Request a new link to continue verification.
        </p>
        <form action={requestNewLivenessLinkAction} className="mt-4">
          <button className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Request new link
          </button>
        </form>
      </div>
    </main>
  )
}
