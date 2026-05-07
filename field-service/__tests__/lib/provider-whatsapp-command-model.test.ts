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

  it('routes all job-execution commands to provider_journey', () => {
    // on the way / arrived / start / complete
    expect(resolveProviderWhatsappCommand('on the way')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('otw')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('en route')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('arrived')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('i arrived')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand("i've arrived")?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('start job')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('start work')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('complete')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('complete job')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('done')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('finish job')?.flow).toBe('provider_journey')
  })

  it('routes opportunity-response commands to provider_journey', () => {
    expect(resolveProviderWhatsappCommand('interested')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('not interested')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('pass')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('accept job')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('decline')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('decline job')?.flow).toBe('provider_journey')
  })

  it('supports common variations without creating duplicate flows', () => {
    expect(resolveProviderWhatsappCommand('hi')?.flow).toBe('provider_journey')
    expect(resolveProviderWhatsappCommand('hello')?.step).toBe('pj_menu')
    expect(resolveProviderWhatsappCommand('find work')?.replyId).toBe('provider_available_jobs')
    expect(resolveProviderWhatsappCommand('available')?.replyId).toBe('provider_go_available')
    expect(resolveProviderWhatsappCommand('unavailable')?.replyId).toBe('provider_pause_leads')
    expect(resolveProviderWhatsappCommand('register')?.flow).toBe('registration')
  })

  it('supports all blueprint-required menu aliases', () => {
    // hi, hello, start, register, find work, balance, credit, my jobs, available, unavailable
    expect(resolveProviderWhatsappCommand('hi')?.step).toBe('pj_menu')
    expect(resolveProviderWhatsappCommand('hello')?.step).toBe('pj_menu')
    expect(resolveProviderWhatsappCommand('start')?.step).toBe('pj_menu')
    expect(resolveProviderWhatsappCommand('balance')?.replyId).toBe('provider_check_status')
    expect(resolveProviderWhatsappCommand('credit')?.replyId).toBe('provider_check_status')
    expect(resolveProviderWhatsappCommand('my jobs')?.replyId).toBe('provider_my_jobs')
    expect(resolveProviderWhatsappCommand('available')?.replyId).toBe('provider_go_available')
    expect(resolveProviderWhatsappCommand('unavailable')?.replyId).toBe('provider_pause_leads')
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

  it('returns null for unrecognised text so invalid commands fall through to helpful response', () => {
    expect(resolveProviderWhatsappCommand('xyzzy')).toBeNull()
    expect(resolveProviderWhatsappCommand('gibberish 123')).toBeNull()
    expect(resolveProviderWhatsappCommand('')).toBeNull()
    expect(resolveProviderWhatsappCommand(null)).toBeNull()
    expect(resolveProviderWhatsappCommand(undefined)).toBeNull()
  })

  it('normalises leading/trailing whitespace and extra spaces', () => {
    expect(resolveProviderWhatsappCommand('  menu  ')?.step).toBe('pj_menu')
    expect(resolveProviderWhatsappCommand('  my   jobs  ')?.replyId).toBe('provider_my_jobs')
    expect(resolveProviderWhatsappCommand('  on the way  ')?.flow).toBe('provider_journey')
  })

  it('is case-insensitive', () => {
    expect(resolveProviderWhatsappCommand('MENU')?.step).toBe('pj_menu')
    expect(resolveProviderWhatsappCommand('Credits')?.step).toBe('pj_provider_status')
    expect(resolveProviderWhatsappCommand('MY JOBS')?.replyId).toBe('provider_my_jobs')
    expect(resolveProviderWhatsappCommand('On The Way')?.flow).toBe('provider_journey')
  })

  it('is idempotent — resolving the same command twice returns identical results', () => {
    const first = resolveProviderWhatsappCommand('menu')
    const second = resolveProviderWhatsappCommand('menu')
    expect(first).toEqual(second)

    const firstCredits = resolveProviderWhatsappCommand('credits')
    const secondCredits = resolveProviderWhatsappCommand('credits')
    expect(firstCredits).toEqual(secondCredits)
  })

  it('every command has a unique canonical command name', () => {
    const names = PROVIDER_WHATSAPP_COMMANDS.map((c) => c.command)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('menu command step is pj_menu for all menu-triggering aliases', () => {
    const menuAliases = ['menu', 'hi', 'hello', 'start', 'provider menu', 'home']
    for (const alias of menuAliases) {
      const result = resolveProviderWhatsappCommand(alias)
      expect(result?.step, `alias "${alias}" should route to pj_menu`).toBe('pj_menu')
    }
  })

  it('start bare keyword routes to pj_menu (not start job — no collision with job execution)', () => {
    // bare "start" → menu (it's in the menu aliases)
    expect(resolveProviderWhatsappCommand('start')?.step).toBe('pj_menu')
    // "start job" → job execution via provider_whatsapp_job_commands path
    expect(resolveProviderWhatsappCommand('start job')?.flow).toBe('provider_journey')
  })

  it('all job-lifecycle commands route to job_execution or job_completion state', () => {
    const onTheWay = resolveProviderWhatsappCommand('on the way')
    const arrived = resolveProviderWhatsappCommand('arrived')
    const startJob = resolveProviderWhatsappCommand('start job')
    const complete = resolveProviderWhatsappCommand('complete')

    expect(onTheWay?.state).toBe('job_execution')
    expect(arrived?.state).toBe('job_execution')
    expect(startJob?.state).toBe('job_execution')
    expect(complete?.state).toBe('job_completion')
  })

  it('help and issue commands route to support state', () => {
    expect(resolveProviderWhatsappCommand('help')?.state).toBe('support')
    expect(resolveProviderWhatsappCommand('support')?.state).toBe('support')
    expect(resolveProviderWhatsappCommand('issue')?.state).toBe('support')
    expect(resolveProviderWhatsappCommand('problem')?.state).toBe('support')
    expect(resolveProviderWhatsappCommand('report issue')?.state).toBe('support')
  })

  it('register command routes to application_capture state', () => {
    expect(resolveProviderWhatsappCommand('register')?.state).toBe('application_capture')
    expect(resolveProviderWhatsappCommand('apply')?.state).toBe('application_capture')
    expect(resolveProviderWhatsappCommand('join')?.state).toBe('application_capture')
  })

  it('menu is always recoverable — pj_menu step is assigned for any menu-type command regardless of context', () => {
    // The command model always returns pj_menu for menu aliases.
    // The bot wires this to override flow/step for provider roles, ensuring recovery from any state.
    const result = resolveProviderWhatsappCommand('menu')
    expect(result).not.toBeNull()
    expect(result?.flow).toBe('provider_journey')
    expect(result?.step).toBe('pj_menu')
  })
})
