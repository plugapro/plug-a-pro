import type { ProviderOnboardingRecoveryTemplateKey } from './provider-onboarding-recovery'
import type { TemplateName, WhatsAppComponent } from './whatsapp'

const RECOVERY_TEMPLATE_BY_MESSAGE_KEY: Readonly<
  Record<ProviderOnboardingRecoveryTemplateKey, TemplateName | null>
> = {
  evidence_upload: 'provider_recovery_evidence',
  started_blocked: 'provider_recovery_started_blocked',
  register_started_no_name: 'provider_recovery_no_name',
  welcome_idle: 'provider_recovery_welcome_idle',
  flow_conflict: 'provider_recovery_flow_conflict',
  submitted_no_recovery: null,
}

export function recoveryTemplateNameForMessageKey(key: ProviderOnboardingRecoveryTemplateKey) {
  return RECOVERY_TEMPLATE_BY_MESSAGE_KEY[key]
}

function firstNameFromProfile(value?: string | null) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const first = trimmed.split(/\s+/)[0]
  return first.length > 0 ? first : null
}

export function buildRecoveryTemplateComponents(params: {
  providerName?: string | null
}): WhatsAppComponent[] {
  const providerName = firstNameFromProfile(params.providerName) ?? 'there'
  return [{
    type: 'body',
    parameters: [
      { type: 'text', text: providerName },
    ],
  }]
}

