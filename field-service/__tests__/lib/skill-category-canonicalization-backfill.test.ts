import { describe, expect, it, vi } from 'vitest'

import { runSkillCategoryCanonicalizationBackfill } from '@/lib/skill-category-canonicalization-backfill'

function makeBackfillClient() {
  const providerApplications = [
    { id: 'app_1', skills: ['Plumbing', 'Painting'], isTestUser: false, cohortName: null },
    { id: 'app_2', skills: ['plumbing'], isTestUser: true, cohortName: 'internal_staff_test' },
  ]
  const providers = [
    { id: 'prov_1', skills: ['Garden & Landscaping'], isTestUser: false, cohortName: null },
  ]
  const jobRequests = [
    { id: 'job_1', category: 'Plumbing', isTestRequest: false, cohortName: null },
    { id: 'job_2', category: 'plumbing', isTestRequest: false, cohortName: null },
  ]
  const waitlists = [
    { id: 'wait_1', category: 'DIY & Assembly' },
    { id: 'wait_2', category: null },
  ]

  const client = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue(providerApplications),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const row = providerApplications.find((item) => item.id === where.id)
          if (row) Object.assign(row, data)
          return row
        }),
      },
      provider: {
        findMany: vi.fn().mockResolvedValue(providers),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const row = providers.find((item) => item.id === where.id)
          if (row) Object.assign(row, data)
          return row
        }),
      },
      jobRequest: {
        findMany: vi.fn().mockResolvedValue(jobRequests),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const row = jobRequests.find((item) => item.id === where.id)
          if (row) Object.assign(row, data)
          return row
        }),
      },
      serviceAreaWaitlist: {
        findMany: vi.fn().mockResolvedValue(waitlists),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const row = waitlists.find((item) => item.id === where.id)
          if (row) Object.assign(row, data)
          return row
        }),
      },
      auditLog: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn(async (callback) => callback(client)),
    }

  return {
    rows: { providerApplications, providers, jobRequests, waitlists },
    client,
  }
}

describe('runSkillCategoryCanonicalizationBackfill', () => {
  it('dry-runs by default and reports exact per-field diffs without writes', async () => {
    const { client } = makeBackfillClient()

    const summary = await runSkillCategoryCanonicalizationBackfill(client)

    expect(summary.mode).toBe('dry-run')
    expect(summary.totalChangedRows).toBe(4)
    expect(summary.fields).toMatchObject({
      'ProviderApplication.skills': { rowsChanged: 1, valuesChanged: 2 },
      'Provider.skills': { rowsChanged: 1, valuesChanged: 1 },
      'JobRequest.category': { rowsChanged: 1, valuesChanged: 1 },
      'ServiceAreaWaitlist.category': { rowsChanged: 1, valuesChanged: 1 },
    })
    expect(client.providerApplication.update).not.toHaveBeenCalled()
    expect(client.auditLog.createMany).not.toHaveBeenCalled()
  })

  it('does not require optional cohort columns while scanning production rows', async () => {
    const { client } = makeBackfillClient()

    await runSkillCategoryCanonicalizationBackfill(client)

    expect(client.providerApplication.findMany).toHaveBeenCalledWith({
      select: { id: true, skills: true },
      orderBy: { id: 'asc' },
    })
    expect(client.provider.findMany).toHaveBeenCalledWith({
      select: { id: true, skills: true },
      orderBy: { id: 'asc' },
    })
    expect(client.jobRequest.findMany).toHaveBeenCalledWith({
      select: { id: true, category: true },
      orderBy: { id: 'asc' },
    })
  })

  it('skips missing optional target tables with a warning', async () => {
    const { client } = makeBackfillClient()
    client.serviceAreaWaitlist.findMany.mockRejectedValueOnce(Object.assign(
      new Error('missing table'),
      { code: 'P2021', meta: { table: 'public.service_area_waitlist' } },
    ))

    const summary = await runSkillCategoryCanonicalizationBackfill(client)

    expect(summary.fields['ServiceAreaWaitlist.category']).toEqual({
      rowsScanned: 0,
      rowsChanged: 0,
      valuesChanged: 0,
    })
    expect(summary.warnings).toContain(
      'ServiceAreaWaitlist.category skipped: missing table public.service_area_waitlist',
    )
  })

  it('apply mode writes changed rows, creates audit rows, and is idempotent', async () => {
    const { client, rows } = makeBackfillClient()

    const first = await runSkillCategoryCanonicalizationBackfill(client, {
      apply: true,
      confirmed: true,
      actorId: 'script:test',
    })

    expect(first.mode).toBe('apply')
    expect(first.totalChangedRows).toBe(4)
    expect(client.$transaction).toHaveBeenCalledOnce()
    expect(rows.providerApplications[0].skills).toEqual(['plumbing', 'painting'])
    expect(rows.providers[0].skills).toEqual(['garden'])
    expect(rows.jobRequests[0].category).toBe('plumbing')
    expect(rows.waitlists[0].category).toBe('diy')
    expect(client.auditLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          actorId: 'script:test',
          actorRole: 'system',
          action: 'service_category.canonicalized',
          entityType: 'ProviderApplication',
          entityId: 'app_1',
          before: expect.objectContaining({ skills: ['Plumbing', 'Painting'] }),
          after: expect.objectContaining({ skills: ['plumbing', 'painting'] }),
        }),
      ]),
    })

    const second = await runSkillCategoryCanonicalizationBackfill(client, {
      apply: true,
      confirmed: true,
      actorId: 'script:test',
    })

    expect(second.totalChangedRows).toBe(0)
  })

  it('requires explicit confirmation before apply mode mutates data', async () => {
    const { client } = makeBackfillClient()

    await expect(
      runSkillCategoryCanonicalizationBackfill(client, { apply: true }),
    ).rejects.toThrow('SKILL_CATEGORY_CANONICALIZATION_CONFIRMATION_REQUIRED')
  })
})
