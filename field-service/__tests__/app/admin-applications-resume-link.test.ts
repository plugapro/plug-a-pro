import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockCrudAction,
  mockConversationFindUnique,
  mockAdminUserFindUniqueOrThrow,
  mockProviderResumeTokenUpdateMany,
  mockProviderResumeTokenCreate,
  mockProviderResumeTokenFindMany,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockConversationFindUnique: vi.fn(),
  mockAdminUserFindUniqueOrThrow: vi.fn(),
  mockProviderResumeTokenUpdateMany: vi.fn(),
  mockProviderResumeTokenCreate: vi.fn(),
  mockProviderResumeTokenFindMany: vi.fn(),
  mockRevalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ id: 'sb-user-1' })),
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/crud-action', () => ({
  CrudActionError: class CrudActionError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'CrudActionError'
    }
  },
  crudAction: mockCrudAction,
}))

// ─── Tx fixture ───────────────────────────────────────────────────────────────

// The tx object passed into the run() callback must surface the Prisma models
// that generateResumeLinkAction's run() closure uses:
//   - tx.adminUser.findUniqueOrThrow  (resolve actor's AdminUser record)
//   - tx.conversation.findUnique      (validate flow)
//   - tx.providerResumeToken.*        (via issueProviderResumeToken)
//
// issueProviderResumeToken detects a TransactionClient by the absence of
// `$transaction`, so we omit it here to force the doInTx branch to run
// directly (not nested).

function makeTx() {
  return {
    adminUser: {
      findUniqueOrThrow: mockAdminUserFindUniqueOrThrow,
    },
    conversation: {
      findUnique: mockConversationFindUnique,
    },
    providerResumeToken: {
      updateMany: mockProviderResumeTokenUpdateMany,
      create: mockProviderResumeTokenCreate,
      findMany: mockProviderResumeTokenFindMany,
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wire mockCrudAction to call the real run() body with the provided tx,
 * passing schema-validated input. Re-throws errors from run().
 */
async function executeCrudActionWith(tx: ReturnType<typeof makeTx>) {
  const { CrudActionError } = await import('@/lib/crud-action')
  mockCrudAction.mockImplementation(async (options: any) => {
    if (options.schema) {
      const parsed = options.schema.safeParse(options.input)
      if (!parsed.success) {
        throw new CrudActionError(
          'VALIDATION',
          parsed.error.issues.map((i: any) => i.message).join('; '),
        )
      }
      const result = await options.run(parsed.data, tx)
      return { ok: true as const, data: result }
    }
    const result = await options.run(options.input, tx)
    return { ok: true as const, data: result }
  })
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ADMIN_USER = { id: 'admin-1', role: 'OWNER', active: true, userId: 'sb-user-1' }

const REGISTRATION_CONV = {
  id: 'conv-1',
  phone: '+27820000001',
  flow: 'registration',
  step: 'name',
}

const JOB_REQUEST_CONV = {
  id: 'conv-2',
  phone: '+27820000002',
  flow: 'job_request',
  step: 'description',
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Defaults
  mockAdminUserFindUniqueOrThrow.mockResolvedValue(ADMIN_USER)
  mockConversationFindUnique.mockResolvedValue(REGISTRATION_CONV)
  mockProviderResumeTokenUpdateMany.mockResolvedValue({ count: 0 })
  mockProviderResumeTokenCreate.mockImplementation(async ({ data }: any) => ({
    id: 'token-row-1',
    ...data,
    createdAt: new Date(),
    updatedAt: new Date(),
  }))
  mockProviderResumeTokenFindMany.mockResolvedValue([])
  mockRevalidatePath.mockReturnValue(undefined)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateResumeLinkAction', () => {
  it('issues a ProviderResumeToken and returns a /provider/signup URL', async () => {
    await executeCrudActionWith(makeTx())

    const { generateResumeLinkAction } = await import(
      '@/app/(admin)/admin/applications/recovery-actions'
    )

    const result = await generateResumeLinkAction({ conversationId: 'conv-1' })

    expect(result).toMatchObject({ ok: true })
    expect((result as any).url).toMatch(/\/provider\/signup\?t=[A-Za-z0-9_-]{43}$/)

    expect(mockProviderResumeTokenCreate).toHaveBeenCalledOnce()
    expect(mockProviderResumeTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conv-1',
          phone: REGISTRATION_CONV.phone,
          issuedByAdminUserId: ADMIN_USER.id,
          source: 'recovery_nudge',
        }),
        select: { id: true },
      }),
    )

    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/applications')
  })

  it('supersedes any prior live token for the same conversation', async () => {
    // Simulate one pre-existing live token getting revoked on first call
    mockProviderResumeTokenUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // first call: revokes old token
      .mockResolvedValueOnce({ count: 0 }) // second call: nothing to revoke

    await executeCrudActionWith(makeTx())

    const { generateResumeLinkAction } = await import(
      '@/app/(admin)/admin/applications/recovery-actions'
    )

    await generateResumeLinkAction({ conversationId: 'conv-1' })
    await generateResumeLinkAction({ conversationId: 'conv-1' })

    // updateMany called twice — once per invocation
    expect(mockProviderResumeTokenUpdateMany).toHaveBeenCalledTimes(2)

    // Confirm the first updateMany revoked with 'superseded'
    expect(mockProviderResumeTokenUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ conversationId: 'conv-1' }),
        data: expect.objectContaining({ revokedReason: 'superseded' }),
      }),
    )

    // Two tokens created
    expect(mockProviderResumeTokenCreate).toHaveBeenCalledTimes(2)
  })

  it('rejects when the conversation is not in registration flow', async () => {
    mockConversationFindUnique.mockResolvedValue(JOB_REQUEST_CONV)

    await executeCrudActionWith(makeTx())

    const { generateResumeLinkAction } = await import(
      '@/app/(admin)/admin/applications/recovery-actions'
    )

    await expect(
      generateResumeLinkAction({ conversationId: 'conv-2' }),
    ).rejects.toThrow(/registration/i)

    expect(mockProviderResumeTokenCreate).not.toHaveBeenCalled()
  })

  it('rejects when the flag is disabled', async () => {
    const { CrudActionError } = await import('@/lib/crud-action')
    mockCrudAction.mockRejectedValue(
      new CrudActionError(
        'FLAG_DISABLED',
        "Feature 'admin.applications.resume_link_button' is not enabled.",
      ),
    )

    const { generateResumeLinkAction } = await import(
      '@/app/(admin)/admin/applications/recovery-actions'
    )

    await expect(
      generateResumeLinkAction({ conversationId: 'conv-1' }),
    ).rejects.toMatchObject({
      name: 'CrudActionError',
      code: 'FLAG_DISABLED',
    })
  })

  it('passes correct requiredFlag and requiredRole to crudAction', async () => {
    await executeCrudActionWith(makeTx())

    const { generateResumeLinkAction } = await import(
      '@/app/(admin)/admin/applications/recovery-actions'
    )

    await generateResumeLinkAction({ conversationId: 'conv-1' })

    expect(mockCrudAction).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredFlag: 'admin.applications.resume_link_button',
        requiredRole: expect.arrayContaining(['OPS', 'ADMIN', 'OWNER']),
        action: 'resume_link.generate',
        entity: 'ProviderResumeToken',
      }),
    )
  })
})
