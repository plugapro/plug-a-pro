// User Journey Flows — visual diagrams of all platform journeys
// Rendered client-side via Mermaid.js

import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { FlowsClient } from './FlowsClient'

export const metadata = buildMetadata({ title: 'User Journey Flows', noIndex: true })

export default async function FlowsPage() {
  await requireAdmin()
  return <FlowsClient />
}
