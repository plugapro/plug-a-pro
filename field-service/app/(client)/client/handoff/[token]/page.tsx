import { redirect } from 'next/navigation'
import { resolveClientPwaDestination } from '@/lib/server/client'
import { LinkExpiredScreen } from '@/components/client/link-expired-screen'

export default async function ClientHandoffPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const destinationUrl = await resolveClientPwaDestination(token)
    redirect(destinationUrl)
  } catch (error) {
    if (error instanceof Error && error.message === 'TOKEN_INVALID') {
      return <LinkExpiredScreen kind="invalid" />
    }
    return <LinkExpiredScreen kind="expired" />
  }
}
