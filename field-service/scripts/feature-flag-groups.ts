import {
  FEATURE_FLAGS_REGISTRY,
  type FeatureFlagKey,
} from '../lib/feature-flags-registry'

export type FeatureFlagTarget = {
  key: FeatureFlagKey
  description: string
}

export const OPS_CRUD_FEATURE_FLAGS = [
  'admin.crud.locations',
  'admin.crud.customers',
  'admin.crud.providers',
  'admin.crud.bookings',
  'admin.crud.payments',
  'admin.crud.disputes',
  'admin.crud.applications',
  'admin.crud.quotes',
  'admin.crud.dispatch',
  'admin.crud.validation',
  'admin.crud.field_exceptions',
  'admin.crud.categories',
  'admin.categories.risk_tier',
  'admin.crud.messages',
  'admin.crud.verifications',
  'admin.users.v2',
  'admin.applications.redesign_v2',
  'admin.quotes.send',
  'admin.invoices.actions',
  'admin.messages.outbound',
  'admin.customers.whatsapp_pref_toggle',
  'admin.vouchers',
  'ops.v2.cases',
  'ops.v2.closeOut',
] as const satisfies readonly FeatureFlagKey[]

export const WHATSAPP_REGISTRATION_FRICTION_FLAGS = [
  'whatsapp.registration.name_profile_shortcut',
  'whatsapp.registration.deeplink',
  'whatsapp.registration.evidence_skip_primary',
  'whatsapp.flow_switch_data_clear',
  'whatsapp.session_prewarning',
] as const satisfies readonly FeatureFlagKey[]

export const FEATURE_FLAG_GROUPS = {
  'ops-crud': OPS_CRUD_FEATURE_FLAGS,
  'whatsapp-registration-friction': WHATSAPP_REGISTRATION_FRICTION_FLAGS,
} as const satisfies Record<string, readonly FeatureFlagKey[]>

export type FeatureFlagGroup = keyof typeof FEATURE_FLAG_GROUPS

export function isFeatureFlagGroup(value: string): value is FeatureFlagGroup {
  return value in FEATURE_FLAG_GROUPS
}

export function listFeatureFlagGroups(): FeatureFlagGroup[] {
  return Object.keys(FEATURE_FLAG_GROUPS) as FeatureFlagGroup[]
}

export function listRegisteredFeatureFlagKeys(): FeatureFlagKey[] {
  return Object.keys(FEATURE_FLAGS_REGISTRY) as FeatureFlagKey[]
}

function toTarget(key: FeatureFlagKey): FeatureFlagTarget {
  return {
    key,
    description: FEATURE_FLAGS_REGISTRY[key].description,
  }
}

export function resolveFeatureFlagTargets(options: {
  flag?: string
  group?: string
} = {}): FeatureFlagTarget[] {
  const { flag, group } = options

  if (flag && group) {
    throw new Error('Use either --flag or --group, not both.')
  }

  if (flag) {
    if (!(flag in FEATURE_FLAGS_REGISTRY)) {
      throw new Error(`Unknown flag: ${flag}`)
    }
    return [toTarget(flag as FeatureFlagKey)]
  }

  if (group) {
    if (!isFeatureFlagGroup(group)) {
      throw new Error(`Unknown flag group: ${group}`)
    }
    return FEATURE_FLAG_GROUPS[group].map(toTarget)
  }

  return listRegisteredFeatureFlagKeys().map(toTarget)
}
