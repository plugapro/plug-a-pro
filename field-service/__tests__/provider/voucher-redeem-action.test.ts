import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('../../lib/auth', () => ({
  requireProvider: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: {
    provider: { findUnique: vi.fn() },
  },
}))

vi.mock('../../lib/voucher-redemption', () => ({
  redeemVoucher: vi.fn(),
}))

describe('provider redeemVoucherAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('echoes the canonical PAP-XXXX-XXXX form in the success message', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { redeemVoucher } = await import('../../lib/voucher-redemption')

    ;(requireProvider as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'user_1' })
    ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'prov_1' })
    ;(redeemVoucher as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      creditsAwarded: 1,
      ledgerEntryId: 'l_1',
      canonical: 'PAP-7KQ9-M2XD',
    })

    const { redeemVoucherAction } = await import('../../app/(provider)/provider/voucher/actions')

    // User types just the 8-char suffix; canonical must still appear in the toast.
    const result = await redeemVoucherAction('7kq9m2xd')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('should be ok')
    expect(result.message).toContain('PAP-7KQ9-M2XD')
    expect(result.message).toContain('1 credit')
  })

  it('passes the user-facing error message through for parse-failure codes', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { redeemVoucher } = await import('../../lib/voucher-redemption')

    ;(requireProvider as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'user_1' })
    ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'prov_1' })
    ;(redeemVoucher as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      code: 'VOUCHER_CODE_TOO_SHORT',
      message: 'ignored — actions surface mapVoucherRedemptionErrorToMessage instead',
    })

    const { redeemVoucherAction } = await import('../../app/(provider)/provider/voucher/actions')

    const result = await redeemVoucherAction('7KQ')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    // Must use the friendly mapped message, not the raw internal string.
    expect(result.message).toMatch(/too short/i)
    expect(result.message).toMatch(/8 characters/i)
  })
})
