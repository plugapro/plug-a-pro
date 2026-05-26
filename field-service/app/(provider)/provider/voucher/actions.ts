'use server'

import { revalidatePath } from 'next/cache'
import { requireProvider } from '@/lib/auth'
import { db } from '@/lib/db'
import { redeemVoucher } from '@/lib/voucher-redemption'
import { mapVoucherRedemptionErrorToMessage } from '@/lib/vouchers'

export type RedeemVoucherActionResult =
  | { ok: true; creditsAwarded: number; message: string }
  | { ok: false; message: string }

// Single DB query: resolves provider.id from the authenticated session.
// Mirrors the getAuthenticatedProvider() helper in credits/actions.ts.
async function getAuthenticatedProvider(): Promise<{ id: string } | null> {
  const session = await requireProvider()
  return db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true },
  })
}

export async function redeemVoucherAction(rawCode: string): Promise<RedeemVoucherActionResult> {
  if (!rawCode?.trim()) {
    return { ok: false, message: 'Please enter a voucher code.' }
  }

  const provider = await getAuthenticatedProvider()

  if (!provider) {
    return { ok: false, message: 'Provider account not found. Please contact support.' }
  }

  try {
    const result = await redeemVoucher(provider.id, rawCode.trim())

    if (result.ok) {
      revalidatePath('/provider/voucher')
      revalidatePath('/provider/credits')
      revalidatePath('/provider')
      return {
        ok: true,
        creditsAwarded: result.creditsAwarded,
        // Echo the canonical form so the user sees exactly which voucher was accepted —
        // useful when they typed it dashless or just the 8-char suffix.
        message: `Voucher ${result.canonical} redeemed. ${result.creditsAwarded} credit${result.creditsAwarded === 1 ? ' has' : 's have'} been added to your account.`,
      }
    }

    return { ok: false, message: mapVoucherRedemptionErrorToMessage(result.code) }
  } catch (err) {
    console.error('[voucher] PWA redemption error', {
      providerId: provider.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, message: 'Something went wrong. Please try again.' }
  }
}
