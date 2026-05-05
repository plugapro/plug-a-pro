import { buildMetadata } from '@/lib/metadata'
import { StatusDashboard } from '@/components/status/StatusDashboard'

export const metadata = buildMetadata({
  title: 'Service status',
  description: 'Public visibility into Plug-A-Pro platform health and user-journey health.',
})

export default function Page() {
  return <StatusDashboard />
}
