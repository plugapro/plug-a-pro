import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProviderOnboardingRecoveryMessage,
  buildProviderOnboardingRecoveryRowsFromSnapshots,
  classifyProviderOnboardingStage,
  listProviderOnboardingRecoveryRows,
  personalizeProviderOnboardingRecoveryMessage,
  recordProviderOnboardingRecoveryOutcome,
  sendProviderOnboardingRecoveryFollowUps,
} from '@/lib/provider-onboarding-recovery'

const now = new Date('2026-06-04T10:00:00.000Z')
const since = new Date('2026-06-04T07:51:00.000Z')

function conversation(overrides: Record<string, unknown>) {
  return {
    id: 'conv-1',
    phone: '+27821234567',
    flow: 'registration',
    step: 'reg_collect_name',
    data: {},
    updatedAt: new Date('2026-06-04T09:20:00.000Z'),
    timeoutNotifiedAt: null,
    ...overrides,
  }
}

describe('provider onboarding recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['registration', 'reg_collect_name', {}, 'register_started_no_name'],
    ['registration', 'reg_collect_name', { selectedCategory: 'plumbing', addressLine1: '12 Main' }, 'flow_conflict'],
    ['registration', 'reg_collect_skills', {}, 'register_started_no_name'],
    ['registration', 'reg_collect_id', { name: 'Thabo Nkosi' }, 'id_verification_started'],
    ['registration', 'reg_verify_upload_doc', { name: 'Thabo Nkosi' }, 'id_verification_started'],
    ['registration', 'reg_collect_skills_more', { name: 'Thabo Nkosi' }, 'skills_picker'],
    ['registration', 'reg_collect_city', { name: 'Thabo Nkosi' }, 'city_picker'],
    ['registration', 'reg_collect_evidence', { name: 'Thabo Nkosi' }, 'evidence_upload'],
    ['registration', 'reg_confirm', { name: 'Thabo Nkosi' }, 'submitted'],
    ['registration', 'reg_collect_city', { flowConflictDetectedAt: '2026-06-04T09:30:00.000Z' }, 'flow_conflict'],
  ])('classifies %s/%s as %s', (flow, step, data, expected) => {
    expect(classifyProviderOnboardingStage({
      flow,
      step,
      data,
      applicationStatus: null,
    })).toBe(expected)
  })

  it.each([
    ['PENDING', 'pending'],
    ['APPROVED', 'approved'],
  ])('classifies application status %s as %s', (applicationStatus, expected) => {
    expect(classifyProviderOnboardingStage({
      flow: 'idle',
      step: 'welcome',
      data: {},
      applicationStatus,
    })).toBe(expected)
  })

  it('builds the operator-approved no-name recovery message', () => {
    const message = buildProviderOnboardingRecoveryMessage('register_started_no_name')

    expect(message).toContain('I noticed you tapped register')
    expect(message).toContain('Example:\nThabo Mokoena')
    expect(message).not.toContain('ID')
  })

  it('personalizes recovery messages from already captured provider names only', () => {
    const message = buildProviderOnboardingRecoveryMessage('evidence_upload')

    expect(personalizeProviderOnboardingRecoveryMessage(message, 'Victor Panavanhu'))
      .toContain('Hi Victor, this is Plug A Pro.')
    expect(personalizeProviderOnboardingRecoveryMessage(message, null))
      .toContain('Hi, this is Plug A Pro.')
  })

  it('builds masked, priority-ordered rows from current inbound WhatsApp users', () => {
    const rows = buildProviderOnboardingRecoveryRowsFromSnapshots({
      now,
      inbound: [
        { phone: '27820000001', firstSeenAt: since, lastSeenAt: since, messageType: 'text' },
        { phone: '27820000002', firstSeenAt: since, lastSeenAt: since, messageType: 'text' },
        { phone: '27820000003', firstSeenAt: since, lastSeenAt: since, messageType: 'text' },
      ],
      conversations: [
        conversation({
          id: 'conv-name',
          phone: '+27820000001',
          step: 'reg_collect_name',
          data: {},
          updatedAt: new Date('2026-06-04T09:30:00.000Z'),
        }),
        conversation({
          id: 'conv-evidence',
          phone: '+27820000002',
          step: 'reg_collect_evidence',
          data: {
            name: 'Naledi Maseko',
            skills: ['Painting'],
            serviceAreas: ['Roodepoort'],
          },
          updatedAt: new Date('2026-06-04T09:20:00.000Z'),
        }),
        conversation({
          id: 'conv-conflict',
          phone: '+27820000003',
          step: 'reg_collect_name',
          data: { selectedCategory: 'plumbing', addressLine1: '12 Main' },
          updatedAt: new Date('2026-06-04T09:25:00.000Z'),
        }),
      ],
      applications: [],
      outcomeEvents: [],
    })

    expect(rows.map((row) => row.stage)).toEqual([
      'evidence_upload',
      'register_started_no_name',
      'flow_conflict',
    ])
    expect(rows[0]).toMatchObject({
      priority: 1,
      phoneMasked: '082****002',
      phoneTail: '0002',
      providerName: 'Naledi Maseko',
      serviceCategory: 'Painting',
      area: 'Roodepoort',
      followUpStatus: 'due',
    })
    expect(JSON.stringify(rows)).not.toContain('+27820000002')
  })

  it('uses audit outcomes to prevent repeat stage follow-ups and expose notes', () => {
    const rows = buildProviderOnboardingRecoveryRowsFromSnapshots({
      now,
      inbound: [
        { phone: '27820000001', firstSeenAt: since, lastSeenAt: since, messageType: 'text' },
      ],
      conversations: [
        conversation({
          id: 'conv-name',
          phone: '+27820000001',
          step: 'reg_collect_name',
          data: {},
          updatedAt: new Date('2026-06-04T09:30:00.000Z'),
        }),
      ],
      applications: [],
      outcomeEvents: [
        {
          entityId: 'wa_88931941c8',
          timestamp: new Date('2026-06-04T09:45:00.000Z'),
          after: {
            outcomeStatus: 'message_sent',
            recoveryStage: 'register_started_no_name',
            notes: 'First manual WhatsApp sent',
          },
        },
      ],
    })

    expect(rows[0]).toMatchObject({
      lastOutcomeStatus: 'message_sent',
      operatorNotes: 'First manual WhatsApp sent',
      followUpStatus: 'already_sent_for_stage',
    })
  })

  it('lists current inbound rows with safe fields and application status', async () => {
    const client = {
      inboundWhatsAppMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            phone: '27821234567',
            messageType: 'text',
            firstSeenAt: new Date('2026-06-04T09:30:00.000Z'),
            lastSeenAt: new Date('2026-06-04T09:30:00.000Z'),
          },
          {
            phone: '27827654321',
            messageType: 'interactive',
            firstSeenAt: new Date('2026-06-04T09:00:00.000Z'),
            lastSeenAt: new Date('2026-06-04T09:45:00.000Z'),
          },
        ]),
      },
      conversation: {
        findMany: vi.fn().mockResolvedValue([
          conversation({
            id: 'conv-name',
            step: 'reg_collect_name',
            data: {},
            updatedAt: new Date('2026-06-04T09:30:00.000Z'),
          }),
        ]),
      },
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'app-approved',
            phone: '+27827654321',
            name: 'Sipho Dlamini',
            status: 'APPROVED',
            submittedAt: new Date('2026-06-04T09:00:00.000Z'),
            reviewedAt: new Date('2026-06-04T09:45:00.000Z'),
            skills: ['Plumbing'],
            serviceAreas: ['Soweto'],
          },
        ]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
    }

    const rows = await listProviderOnboardingRecoveryRows(client as never, {
      now,
      since,
    })

    expect(rows).toEqual([
      expect.objectContaining({
        source: 'conversation',
        stage: 'register_started_no_name',
        phoneMasked: '082****567',
        phoneTail: '4567',
        lastInteractionAt: new Date('2026-06-04T09:30:00.000Z'),
      }),
      expect.objectContaining({
        source: 'application',
        stage: 'approved',
        applicationStatus: 'APPROVED',
        serviceCategory: 'Plumbing',
        area: 'Soweto',
        lastInteractionAt: new Date('2026-06-04T09:45:00.000Z'),
      }),
    ])
  })

  it('sends due WhatsApp recovery follow-ups and logs sent outcomes without raw phone numbers', async () => {
    const client = {
      inboundWhatsAppMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            phone: '27820000001',
            messageType: 'text',
            firstSeenAt: since,
            lastSeenAt: new Date('2026-06-04T09:20:00.000Z'),
          },
          {
            phone: '27820000002',
            messageType: 'text',
            firstSeenAt: since,
            lastSeenAt: new Date('2026-06-04T09:20:00.000Z'),
          },
        ]),
      },
      conversation: {
        findMany: vi.fn().mockResolvedValue([
          conversation({
            id: 'conv-name',
            phone: '+27820000001',
            step: 'reg_collect_name',
            data: {},
            updatedAt: new Date('2026-06-04T09:20:00.000Z'),
          }),
          conversation({
            id: 'conv-submitted',
            phone: '+27820000002',
            step: 'reg_confirm',
            data: { name: 'Submitted Provider' },
            updatedAt: new Date('2026-06-04T09:20:00.000Z'),
          }),
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }
    const sendText = vi.fn().mockResolvedValue('wamid.recovery.1')

    const result = await sendProviderOnboardingRecoveryFollowUps(client as never, {
      now,
      since,
      sendText,
    })

    expect(result).toMatchObject({
      total: 2,
      due: 1,
      sent: 1,
      skipped: 0,
      errors: 0,
    })
    expect(sendText).toHaveBeenCalledWith(
      '+27820000001',
      expect.stringContaining('full name'),
      expect.objectContaining({
        templateName: 'provider_onboarding_recovery:register_started_no_name',
      }),
    )
    expect(client.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-name', timeoutNotifiedAt: null },
      data: { timeoutNotifiedAt: new Date(0) },
    })
    expect(client.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-name', timeoutNotifiedAt: new Date(0) },
      data: { timeoutNotifiedAt: now },
    })
    expect(client.auditLog.create).toHaveBeenCalledTimes(1)
    const call = client.auditLog.create.mock.calls[0][0]
    expect(call.data).toMatchObject({
      actorId: 'cron:provider-onboarding-recovery',
      action: 'provider_onboarding_recovery.outcome_logged',
      entityType: 'ProviderOnboardingRecovery',
    })
    expect(call.data.after).toMatchObject({
      outcomeStatus: 'message_sent',
      recoveryStage: 'register_started_no_name',
      messageTemplateKey: 'register_started_no_name',
    })
    expect(JSON.stringify(call.data)).not.toContain('+27820000001')
    expect(JSON.stringify(call.data)).not.toContain('27820000001')
  })

  it('records manual recovery outcomes without writing raw phone numbers', async () => {
    const client = {
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }

    await recordProviderOnboardingRecoveryOutcome(client as never, {
      safeUserRef: 'wa_4179bfef51',
      phoneMasked: '082****567',
      phoneTail: '4567',
      recoveryStage: 'register_started_no_name',
      messageTemplateKey: 'register_started_no_name',
      outcomeStatus: 'message_sent',
      notes: 'Manual WhatsApp sent from operator phone',
      nextFollowUpAt: new Date('2026-06-04T10:30:00.000Z'),
      actorId: 'operator:test',
    })

    const call = client.auditLog.create.mock.calls[0][0]
    expect(call.data).toMatchObject({
      actorId: 'operator:test',
      actorRole: 'operator',
      action: 'provider_onboarding_recovery.outcome_logged',
      entityType: 'ProviderOnboardingRecovery',
      entityId: 'wa_4179bfef51',
    })
    expect(JSON.stringify(call.data)).toContain('082****567')
    expect(JSON.stringify(call.data)).not.toContain('+27821234567')
    expect(JSON.stringify(call.data)).not.toContain('27821234567')
  })
})
