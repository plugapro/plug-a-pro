import Link from 'next/link'

export function LinkExpiredScreen() {
  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="rounded-3xl border border-border bg-card p-6">
        <p className="text-lg font-bold">This link has expired</p>
        <p className="mt-2 text-sm text-[var(--ink-mute)]">
          Open the latest WhatsApp message from Plug A Pro for a fresh link, or sign in to continue.
        </p>
        <div className="mt-5 grid gap-2">
          <Link className="rounded-xl bg-[var(--ink)] px-4 py-3 text-center text-sm font-semibold text-white" href="/sign-in">
            Sign in
          </Link>
          <Link className="rounded-xl border border-border bg-card px-4 py-3 text-center text-sm font-semibold" href="/client">
            Go to home
          </Link>
        </div>
      </div>
    </div>
  )
}

