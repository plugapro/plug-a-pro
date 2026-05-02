import { describe, expect, it } from 'vitest'
import {
  PROVIDER_WHATSAPP_COMMANDS,
  getProviderWhatsappStateNames,
  resolveProviderWhatsappCommand,
} from '../../lib/provider-whatsapp-command-model'

describe('provider WhatsApp command model', () => {
  it('routes required provider text commands to the canonical provider journey', () => {
    expect(resolveProviderWhatsappCommand('menu')?.step).toBe('pj_menu')
    expect(resolveProviderWhatsappCommand('credits')?.step).toBe('pj_provider_status')
    expect(resolveProviderWhatsappCommand('balance')?.replyId).toBe('provider_check_status')
    expect(resolveProviderWhatsappCommand('credit history')?.replyId).toBe('provider_check_status')
    expect(resolveProviderWhatsappCommand('jobs')?.step).toBe('pj_job_list')
    expect(resolveProviderWhatsappCommand('my jobs')?.replyId).toBe('provider_my_jobs')
    expect(resolveProviderWhatsappCommand('profile')?.step).toBe('pj_profile')
    expect(resolveProviderWhatsappCommand('availability')?.step).toBe('pj_toggle_available')
    expect(resolveProviderWhatsappCommand('help')?.step).toBe('pj_support')
    expect(resolveProviderWhatsappCommand('issue')?.step).toBe('pj_problem_report')
  })

  it('supports common variations without creating duplicate flows', () => {
    expect(resolveProviderWhatsappCommand('hi')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('hello')?.step).toBe('pj_menu')
    expect(resolveProviderWhatsappCommand('find work')?.replyId).toBe('provider_available_jobs')
    expect(resolveProviderWhatsappCommand('available')?.replyId).toBe('provider_go_available')
    expect(resolveProviderWhatsappCommand('unavailable')?.replyId).toBe('provider_pause_leads')
    expect(resolveProviderWhatsappCommand('register')?.flow).toBe('registration')
  })

  it('covers the provider state names required by the blueprint', () => {
    expect(getProviderWhatsappStateNames()).toEqual([
      'application_capture',
      'application_submitted',
      'pending_review',
      'approved_idle',
      'opportunity_review',
      'interest_capture_callout',
      'interest_capture_arrival',
      'interest_capture_rate',
      'customer_selected_pending_acceptance',
      'accepted_job_active',
      'arrival_confirmation',
      'job_execution',
      'job_completion',
      'support',
    ])
  })

  it('keeps all non-registration provider commands on provider_journey', () => {
    const nonRegistration = PROVIDER_WHATSAPP_COMMANDS.filter((command) => command.command !== 'register')

    expect(nonRegistration.every((command) => command.flow === 'provider_journey')).toBe(true)
  })
})
