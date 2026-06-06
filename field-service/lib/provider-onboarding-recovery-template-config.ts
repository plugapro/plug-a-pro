import type { TemplateName } from './messaging-templates'
import type { ProviderOnboardingRecoveryTemplateKey } from './provider-onboarding-recovery'
import type { WhatsAppComponent } from './whatsapp'

const RECOVERY_TEMPLATE_BY_MESSAGE_KEY = {
  evidence_upload: 'provider_recovery_evidence',
  started_blocked: 'provider_recovery_started_blocked',
  register_started_no_name: 'provider_recovery_no_name',
  welcome_idle: 'provider_recovery_welcome_idle',
  flow_conflict: 'provider_recovery_flow_conflict',
  submitted_no_recovery: null,
} as const satisfies Record<ProviderOnboardingRecoveryTemplateKey, TemplateName | null>

function safeProviderFirstName(providerName: string | null) {
  const firstToken = providerName?.trim().split(/\s+/)[0] ?? ''
  const firstName = firstToken.replace(/[^A-Za-z'-]/g, '')
  return firstName.length >= 2 && firstName.length <= 40 ? firstName : 'there'
}

export function recoveryTemplateNameForMessageKey(
  key: ProviderOnboardingRecoveryTemplateKey,
): TemplateName | null {
  return RECOVERY_TEMPLATE_BY_MESSAGE_KEY[key]
}

export function buildRecoveryTemplateComponents(input: {
  providerName: string | null
}): WhatsAppComponent[] {
  return [
    {
      type: 'body',
      parameters: [{ type: 'text', text: safeProviderFirstName(input.providerName) }],
    },
  ]
}
