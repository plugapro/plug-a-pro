import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const metadata = buildMetadata({ title: 'Link Expired', noIndex: true })

const REASONS: Record<string, { heading: string; body: string }> = {
  expired: {
    heading: 'This link has expired.',
    body: 'Request links are time-limited for your security. Open the most recent WhatsApp message from Plug A Pro to get a fresh link, or start a new request below.',
  },
  invalid: {
    heading: 'This link is no longer valid.',
    body: 'We could not verify access to this request. The link may have been revoked or is incorrect. Open the most recent WhatsApp message from Plug A Pro, or start a new request below.',
  },
  unauthorized: {
    heading: 'We could not verify access to this request.',
    body: 'Please use the link sent to you on WhatsApp or sign in to your account to view your requests.',
  },
}

const DEFAULT_REASON = REASONS.invalid

export default async function AccessRecoveryPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string }>
}) {
  const resolvedParams = searchParams ? await searchParams : {}
  const reason = resolvedParams.reason ?? 'invalid'
  const copy = REASONS[reason] ?? DEFAULT_REASON

  const showSignIn = reason === 'unauthorized' || reason === 'expired' || reason === 'invalid'

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-12">
      <Card>
        <CardContent className="space-y-4 px-4 py-6">
          <p className="font-semibold text-sm">{copy.heading}</p>
          <p className="text-sm text-muted-foreground">{copy.body}</p>
          <Button asChild className="w-full">
            <Link href="/">Start a new request</Link>
          </Button>
          {showSignIn && (
            <Button asChild variant="outline" className="w-full">
              <Link href="/sign-in">Sign in to your account</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
