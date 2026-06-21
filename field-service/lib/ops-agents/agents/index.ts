// ─── Ops agents — registry ───────────────────────────────────────────────────
// The four Phase 1 agents, plus a registry the cron entrypoint and the admin
// "Run agents now" action iterate over.

import type { OpsAgentKey } from '@prisma/client'
import { providerApplicationReviewAgent } from './application-review'
import { providerProfileCoachAgent } from './profile-coach'
import { serviceRequestFrictionAgent } from './request-friction'
import { matchingJourneyMonitorAgent } from './matching-monitor'

export { providerApplicationReviewAgent } from './application-review'
export { providerProfileCoachAgent } from './profile-coach'
export { serviceRequestFrictionAgent } from './request-friction'
export { matchingJourneyMonitorAgent } from './matching-monitor'

 
export const PHASE_1_AGENTS: Array<{ key: OpsAgentKey; agent: any }> = [
  { key: 'PROVIDER_APPLICATION_REVIEW', agent: providerApplicationReviewAgent },
  { key: 'PROVIDER_PROFILE_COACH', agent: providerProfileCoachAgent },
  { key: 'SERVICE_REQUEST_FRICTION', agent: serviceRequestFrictionAgent },
  { key: 'MATCHING_JOURNEY_MONITOR', agent: matchingJourneyMonitorAgent },
]
