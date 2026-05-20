import { redirect } from 'next/navigation'
import { resolveClientPwaDestination as resolveRawDestination } from '@/lib/client-pwa-destination'
import { LinkExpiredScreen } from '@/components/client/link-expired-screen'

export default async function ClientHandoffPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const destination = await resolveRawDestination({ token }).catch(() => null)
  if (!destination) return <LinkExpiredScreen />
  const requestId = destination.request?.id
  const jobId = destination.job?.id

  if (destination.screen === 'expired' || destination.screen === 'invalid_link') {
    return <LinkExpiredScreen />
  }
  if (jobId && (destination.screen === 'job_tracking' || destination.screen === 'active_job')) {
    redirect(`/client/jobs/${jobId}/status`)
  }
  if (jobId && destination.screen === 'completion_review') {
    redirect(`/client/jobs/${jobId}`)
  }
  if (requestId && destination.screen === 'shortlist') {
    redirect(`/client/requests/${requestId}/shortlist`)
  }
  if (requestId && destination.screen === 'provider_confirmation') {
    redirect(`/client/requests/${requestId}/selected`)
  }
  if (requestId && (destination.screen === 'matching_progress' || destination.screen === 'providers_reviewing' || destination.screen === 'request_submitted')) {
    redirect(`/client/requests/${requestId}/matching`)
  }
  if (requestId) {
    redirect(`/client/requests/${requestId}`)
  }

  redirect('/client')
}
