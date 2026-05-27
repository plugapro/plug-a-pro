import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDel,
  mockCreateClient,
  mockFrom,
  mockRemove,
} = vi.hoisted(() => ({
  mockDel: vi.fn(),
  mockCreateClient: vi.fn(),
  mockFrom: vi.fn(),
  mockRemove: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  get: vi.fn(),
  del: mockDel,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}))

vi.mock('../../lib/db', () => ({
  db: {
    attachment: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

describe('deleteIdentityDocumentByBlobKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    mockCreateClient.mockReturnValue({
      storage: {
        from: mockFrom,
      },
    })
    mockFrom.mockReturnValue({ remove: mockRemove })
    mockRemove.mockResolvedValue({ data: [{ name: 'ID_FRONT.pdf' }], error: null })
    mockDel.mockResolvedValue(undefined)
  })

  it('deletes Supabase identity document references via Supabase Storage', async () => {
    const { deleteIdentityDocumentByBlobKey } = await import('../../lib/storage')

    await expect(
      deleteIdentityDocumentByBlobKey('supabase://identity-documents/identity/ver-1/ID_FRONT.pdf'),
    ).resolves.toEqual({ backend: 'supabase', ok: true })

    expect(mockCreateClient).toHaveBeenCalledWith('https://supabase.test', 'service-role-key', {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
    expect(mockFrom).toHaveBeenCalledWith('identity-documents')
    expect(mockRemove).toHaveBeenCalledWith(['identity/ver-1/ID_FRONT.pdf'])
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('captures Supabase deletion errors without throwing', async () => {
    const { deleteIdentityDocumentByBlobKey } = await import('../../lib/storage')
    mockRemove.mockResolvedValueOnce({
      data: null,
      error: { statusCode: '500', message: 'storage unavailable' },
    })

    await expect(
      deleteIdentityDocumentByBlobKey('supabase://identity-documents/identity/ver-1/ID_FRONT.pdf'),
    ).resolves.toEqual({
      backend: 'supabase',
      ok: false,
      error: '500 storage unavailable',
    })
  })

  it('deletes legacy Vercel Blob references via Blob deletion', async () => {
    const { deleteIdentityDocumentByBlobKey } = await import('../../lib/storage')

    await expect(
      deleteIdentityDocumentByBlobKey('identity/ver-1/ID_FRONT.pdf'),
    ).resolves.toEqual({ backend: 'vercel_blob', ok: true })

    expect(mockDel).toHaveBeenCalledWith('identity/ver-1/ID_FRONT.pdf')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('reports malformed Supabase references as unparseable without throwing', async () => {
    const { deleteIdentityDocumentByBlobKey } = await import('../../lib/storage')

    await expect(deleteIdentityDocumentByBlobKey('supabase://identity-documents')).resolves.toEqual({
      backend: 'unparseable',
      ok: false,
      error: 'Malformed Supabase identity document reference',
    })

    expect(mockDel).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
