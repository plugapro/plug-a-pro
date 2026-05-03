import type { Role } from '@prisma/client'

const ROLE_LEVEL: Record<Role, number> = {
  OPS: 1,
  FINANCE: 2,
  TRUST: 3,
  ADMIN: 4,
  OWNER: 5,
}

export const OPS_CAPABILITIES = {
  viewRequests: ['OPS', 'ADMIN', 'OWNER'],
  viewSensitiveCustomerDetails: ['OPS', 'ADMIN', 'OWNER'],
  reviewProviderApplications: ['OPS', 'ADMIN', 'OWNER'],
  approveProviders: ['ADMIN', 'OWNER'],
  suspendProviders: ['ADMIN', 'OWNER'],
  overrideMatching: ['ADMIN', 'OWNER'],
  viewCreditLedger: ['FINANCE', 'ADMIN', 'OWNER'],
  adjustCredits: ['FINANCE', 'ADMIN', 'OWNER'],
  retryNotifications: ['OPS', 'ADMIN', 'OWNER'],
  runSchedulers: ['ADMIN', 'OWNER'],
  viewAuditLog: ['ADMIN', 'OWNER'],
} as const satisfies Record<string, readonly Role[]>

export type OpsCapability = keyof typeof OPS_CAPABILITIES

export function roleCan(role: Role, capability: OpsCapability) {
  const allowed = OPS_CAPABILITIES[capability]
  const actorLevel = ROLE_LEVEL[role]
  return allowed.some((required) => actorLevel >= ROLE_LEVEL[required])
}

export function rolesForCapability(capability: OpsCapability): Role[] {
  return [...OPS_CAPABILITIES[capability]]
}
