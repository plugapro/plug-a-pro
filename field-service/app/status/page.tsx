import type { Metadata } from 'next'
import { StatusDashboard } from '@/components/status/StatusDashboard'
import { buildMetadata } from '@/lib/metadata'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildMetadata({
  title: 'Public Service Status',
  description: 'Live visibility into core Plug-A-Pro platform and journey health.',
  path: '/status',
})

export default function StatusPage() {
  return <StatusDashboard />
}
