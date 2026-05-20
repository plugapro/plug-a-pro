'use server'

import { revalidatePath } from 'next/cache'
import { requireProvider } from '@/lib/auth'
import { db } from '@/lib/db'
import { redeemVoucher } from '@/lib/voucher-redemption'
import { mapVoucherRedemptionErrorToMessage } from '@/lib/vouchers'

export type RedeemVoucherActionResult =
  | { ok: true; creditsAwarded: number; message: string }
  | { ok: false; message: string }

export async function redeemVoucherAction(rawCode: string): Promise<RedeemVoucherActionResult> {
  const session = await requireProvider()

  if (!rawCode?.trim()) {
    return { ok: false, message: 'Please enter a voucher code.' }
  }

  // Resolve the canonical provider.id from the session user, mirroring the
  // pattern used in credits/actions.ts#getAuthenticatedProvider()
  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true },
  })

  if (!provider) {
    return { ok: false, message: 'Provider account not found. Please contact support.' }
  }

  const result = await redeemVoucher(provider.id, rawCode.trim())

  if (result.ok) {
    revalidatePath('/provider/voucher')
    revalidatePath('/provider/credits')
    revalidatePath('/provider')
    return {
      ok: true,
      creditsAwarded: result.creditsAwarded,
      message: `Voucher redeemed. ${result.creditsAwarded} credit${result.creditsAwarded === 1 ? ' has' : 's have'} been added to your account.`,
    }
  }

  return { ok: false, message: mapVoucherRedemptionErrorToMessage(result.code) }
}
