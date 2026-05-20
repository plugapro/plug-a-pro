import type { DisputeStatus } from '@prisma/client'

export type DisputeResolutionStatus = Extract<
  DisputeStatus,
  'RESOLVED_CUSTOMER' | 'RESOLVED_PROVIDER' | 'RESOLVED_SPLIT'
>

export const DISPUTE_RESOLUTION_OPTIONS: Array<{
  status: DisputeResolutionStatus
  label: string
  badgeLabel: string
}> = [
  {
    status: 'RESOLVED_CUSTOMER',
    label: 'Refund customer',
    badgeLabel: 'resolved · customer',
  },
  {
    status: 'RESOLVED_PROVIDER',
    label: 'Side with provider',
    badgeLabel: 'resolved · provider',
  },
  {
    status: 'RESOLVED_SPLIT',
    label: 'Split 50/50',
    badgeLabel: 'resolved · split',
  },
]

export function getDisputeResolutionLabel(status: DisputeStatus) {
  return DISPUTE_RESOLUTION_OPTIONS.find((option) => option.status === status)?.badgeLabel
    ?? status.replaceAll('_', ' ').toLowerCase()
}
