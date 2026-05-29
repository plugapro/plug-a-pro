import Link from 'next/link'

type LinkErrorKind = 'expired' | 'invalid' | 'not_found'

type LinkExpiredScreenProps = {
  kind?: LinkErrorKind
}

export function LinkExpiredScreen({ kind = 'expired' }: LinkExpiredScreenProps) {
  const isInvalid = kind === 'invalid'
  const isNotFound = kind === 'not_found'
  const title = isInvalid ? 'This link is invalid' : isNotFound ? 'Receipt not found' : 'This link has expired'
  const body = isInvalid
    ? 'We could not verify this link. Ask support for a fresh link or sign in to continue from your account.'
    : isNotFound
      ? 'This invoice link is no longer available. Open the latest WhatsApp message from Plug A Pro for an updated receipt link.'
      : 'Open the latest WhatsApp message from Plug A Pro for a fresh link or sign in to continue.'

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="rounded-3xl border border-border bg-card p-6">
        <p className="text-lg font-bold">{title}</p>
        <p className="mt-2 text-sm text-[var(--ink-mute)]">{body}</p>
        <div className="mt-5 grid gap-2">
          <Link className="rounded-xl bg-[var(--ink)] px-4 py-3 text-center text-sm font-semibold text-white" href="/sign-in">
            Sign in
          </Link>
          <Link className="rounded-xl border border-border bg-card px-4 py-3 text-center text-sm font-semibold" href={isInvalid ? '/client/legal/contact' : '/client'}>
            {isInvalid ? 'Contact support' : 'Go to home'}
          </Link>
        </div>
      </div>
    </div>
  )
}
