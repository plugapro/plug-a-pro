import { describe, expect, it, vi } from 'vitest'
import { resumeMoreInfoApplication } from '../../lib/provider-applications'

function makeClient(application: { id: string; status: string; notes: string | null } | null) {
  return {
    providerApplication: {
      findUnique: vi.fn().mockResolvedValue(application),
      update: vi.fn().mockResolvedValue({ id: 'app-1', status: 'PENDING' }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  }
}

describe('resumeMoreInfoApplication', () => {
  it('moves a MORE_INFO_REQUIRED application back to PENDING and appends the provider reply', async () => {
    const client = makeClient({ id: 'app-1', status: 'MORE_INFO_REQUIRED', notes: 'Admin asked for ID copy.' })

    const result = await resumeMoreInfoApplication(client, {
      applicationId: 'app-1',
      providerNote: 'Sent ID — see latest message.',
    })

    expect(result).toEqual({ ok: true, status: 'PENDING' })
    expect(client.providerApplication.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'app-1' },
      data: expect.objectContaining({ status: 'PENDING' }),
    }))
    const updateCall = client.providerApplication.update.mock.calls[0][0]
    expect(updateCall.data.notes).toContain('Admin asked for ID copy.')
    expect(updateCall.data.notes).toContain('Sent ID — see latest message.')
    expect(client.auditLog.create).toHaveBeenCalled()
  })

  it('refuses to resume an application that is not in MORE_INFO_REQUIRED', async () => {
    const client = makeClient({ id: 'app-1', status: 'PENDING', notes: null })

    const result = await resumeMoreInfoApplication(client, {
      applicationId: 'app-1',
      providerNote: 'Already pending',
    })

    expect(result).toEqual({ ok: false, reason: 'INVALID_STATUS' })
    expect(client.providerApplication.update).not.toHaveBeenCalled()
  })

  it('returns NOT_FOUND when the application does not exist', async () => {
    const client = makeClient(null)

    const result = await resumeMoreInfoApplication(client, {
      applicationId: 'missing',
      providerNote: 'anything',
    })

    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect(client.providerApplication.update).not.toHaveBeenCalled()
  })
})
