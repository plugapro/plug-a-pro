// ─── Cron: Expire stale PENDING_PAYMENT intents ───────────────────────────────
// Schedule: 0 * * * * (hourly)
//
// Marks PENDING_PAYMENT intents whose expiresAt has passed as EXPIRED.
// Prevents the PENDING_PAYMENT pool from growing unbounded and avoids the
// H-4 duplicate-intent guard incorrectly blocking a new top-up attempt
// against an already-lapsed Pay@ link.
//
// Only touches intents with a non-null expiresAt - MANUAL_EFT intents without
// an expiry date are left for admin reconciliation.

import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { creditProviderWalletFromPayatWebhook } from '@/lib/provider-credit-gateway-itn'
import { isEnabled } from '@/lib/flags'
import { reconcilePayatIntent } from '@/lib/payat/reconcile'

const PAYAT_ITN_RECOVERY_BATCH = 25
const PAYAT_RECONCILE_BATCH = 50
// How long we keep deferring an intent Pay@ still reports as PENDING
// (PROCESSING_PAYMENT / PAYMENT_READY_FOR_SETTLEMENT) before giving up and
// letting it expire unpaid. Bounds the case where Pay@ never resolves the
// intent so it can't block that provider's future top-ups indefinitely.
const PAYAT_RECONCILE_DEFER_MAX_DAYS = 7
const PAYAT_RECONCILE_DEFER_MAX_MS = PAYAT_RECONCILE_DEFER_MAX_DAYS * 24 * 60 * 60 * 1000

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'expire-payment-intents'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const reqId = crypto.randomUUID().slice(0, 8)
    const now = new Date()

    let payatReconciled = 0
    let payatReconcileSkipped = 0
    let payatReconcileFailed = 0
    let silentExpiries = 0
    let payatDeferred = 0
    let payatDeferTimeouts = 0
    // Intents that must NOT be marked EXPIRED this run because Pay@ still
    // reports them as PENDING (money in flight), or because we could not
    // read Pay@ at all and don't know. Excluded from the updateMany below
    // and re-read on the next cron cycle.
    const deferredIntentIds: string[] = []
    // Every id we attempted this run, whether it was credited, deferred,
    // found genuinely unpaid, skipped, or failed. Used to bound the blast
    // radius of the batch cap below.
    const sweptIntentIds = new Set<string>()
    let batchSaturated = false

    if (await isEnabled('payments.payat.reconcile_sweep')) {
      // Every Pay@ intent about to be expired gets one last authoritative check.
      // Order matters: EXPIRED is not in GATEWAY_CREDITABLE_STATUSES, so this
      // must happen before the updateMany below - an intent expired first can
      // never be credited afterwards.
      const dueForExpiry = await db.paymentIntent.findMany({
        where: {
          paymentMethod: 'PAYAT',
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: now, not: null },
          clientAccountNumber: { not: null },
        },
        select: { id: true, createdAt: true },
        orderBy: { expiresAt: 'asc' },
        take: PAYAT_RECONCILE_BATCH,
      })

      batchSaturated = dueForExpiry.length === PAYAT_RECONCILE_BATCH
      if (batchSaturated) {
        // There may be more eligible PAYAT intents than we fetched this run.
        // The updateMany below must not blind-expire whatever we didn't get
        // to - see the un-swept-intent exclusion applied to it.
        console.error(JSON.stringify({
          event: 'payat.reconcile_batch_saturated',
          batchSize: PAYAT_RECONCILE_BATCH,
        }))
      }

      const deferCutoff = new Date(now.getTime() - PAYAT_RECONCILE_DEFER_MAX_MS)

      for (const intent of dueForExpiry) {
        sweptIntentIds.add(intent.id)
        try {
          const outcome = await reconcilePayatIntent(intent.id)

          if (outcome.action === 'credited') {
            payatReconciled += 1
            continue
          }

          if (outcome.action === 'not_paid') {
            if (outcome.internalStatus === 'PENDING' && intent.createdAt > deferCutoff) {
              // Pay@ says the money is mid-settlement (PROCESSING_PAYMENT /
              // PAYMENT_READY_FOR_SETTLEMENT). Leave it PENDING_PAYMENT so it
              // is re-read next cycle instead of expiring it out from under
              // an in-flight payment. This is good news, not a failure -
              // tracked separately from silentExpiries.
              payatDeferred += 1
              deferredIntentIds.push(intent.id)
              continue
            }

            if (outcome.internalStatus === 'PENDING') {
              // Still PENDING after PAYAT_RECONCILE_DEFER_MAX_DAYS - stop
              // deferring so this can't block the provider's future
              // top-ups forever. Pay@ told us money was in flight and we
              // gave up waiting - the opposite claim from a silent expiry
              // (money never found), needs a human on the Pay@ portal, and
              // is tracked in its own counter with its own event name.
              payatDeferTimeouts += 1
              console.error(JSON.stringify({
                event: 'payat.deferred_expiry',
                intentId: intent.id,
                internalStatus: outcome.internalStatus,
              }))
              continue
            }

            silentExpiries += 1
            // Loud on purpose: money was requested, the window closed, and no
            // payment was found. If this is ever non-zero while providers say
            // they paid, the read path itself is wrong.
            console.error(JSON.stringify({
              event: 'payat.silent_expiry',
              intentId: intent.id,
              internalStatus: outcome.internalStatus,
            }))
            continue
          }

          // outcome.action === 'skipped' - not an error. Benign for
          // already-credited intents and the loser of a concurrent
          // double-credit race; logged (not at error level) so the reason
          // is still visible without being treated as a failure.
          payatReconcileSkipped += 1
          console.warn(JSON.stringify({
            event: 'payat.reconcile_skipped',
            intentId: intent.id,
            reason: outcome.reason,
          }))
        } catch (error) {
          // reconcilePayatIntent throws on any Pay@ read failure (network,
          // non-2xx, missing rtp:read scope, bad JSON) - which means we do
          // NOT know whether the provider paid. Defer rather than let it
          // fall through to expiry: expiring here is irreversible (EXPIRED
          // is not creditable), while deferring just retries next hour,
          // still bounded by the same 7-day cutoff as a confirmed PENDING.
          // This matters most on first rollout, before rtp:read is granted,
          // when every read 403s.
          if (intent.createdAt > deferCutoff) {
            deferredIntentIds.push(intent.id)
          }
          payatReconcileFailed += 1
          console.error(JSON.stringify({
            event: 'payat.reconcile_failed',
            intentId: intent.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          }))
        }
      }
    }

    const expiryWhere: Prisma.PaymentIntentWhereInput = {
      status: 'PENDING_PAYMENT',
      expiresAt: { lt: now, not: null },
    }

    if (batchSaturated) {
      // Batch cap hit: an unknown number of un-swept PAYAT intents with a
      // clientAccountNumber may still be due for expiry. Protect them (and
      // anything explicitly deferred from this batch) from being expired
      // blind - they'll be picked up on a later run.
      expiryWhere.NOT = {
        OR: [
          { id: { in: deferredIntentIds } },
          {
            paymentMethod: 'PAYAT',
            clientAccountNumber: { not: null },
            id: { notIn: Array.from(sweptIntentIds) },
          },
        ],
      }
    } else if (deferredIntentIds.length > 0) {
      expiryWhere.id = { notIn: deferredIntentIds }
    }

    const result = await db.paymentIntent.updateMany({
      where: expiryWhere,
      data: { status: 'EXPIRED' },
    })

    console.log(`[cron/expire-payment-intents:${reqId}] expired=${result.count}, payat-reconciled=${payatReconciled}, payat-reconcile-skipped=${payatReconcileSkipped}, payat-reconcile-failed=${payatReconcileFailed}, payat-deferred=${payatDeferred}, payat-defer-timeouts=${payatDeferTimeouts}, silent-expiries=${silentExpiries}`)

    const itnIntents = await db.paymentIntent.findMany({
      where: {
        paymentMethod: 'PAYAT',
        status: 'ITN_RECEIVED',
        creditedAt: null,
        itnPaymentStatus: { in: ['PAID', 'COMPLETED'] },
        itnReceivedAt: { not: null },
      },
      select: { id: true },
      orderBy: { itnReceivedAt: 'asc' },
      take: PAYAT_ITN_RECOVERY_BATCH,
    })

    let recovered = 0
    let skipped = 0
    let failed = 0

    for (const it of itnIntents) {
      try {
        const recoveryResult = await creditProviderWalletFromPayatWebhook(it.id)
        if (recoveryResult.credited) {
          recovered += 1
          continue
        }

        skipped += 1
        console.warn('[cron/expire-payment-intents] payat itn recovery skipped', {
          reqId,
          intentId: it.id,
          reason: recoveryResult.reason,
        })
      } catch (error) {
        failed += 1
        console.error('[cron/expire-payment-intents] payat itn recovery failed', {
          reqId,
          intentId: it.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    console.log(`[cron/expire-payment-intents:${reqId}] payat-itn-recovered=${recovered}, skipped=${skipped}, failed=${failed}`)
    const duration = Date.now() - cronStart
    console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
    return NextResponse.json({
      expired: result.count,
      payatReconciled,
      payatReconcileSkipped,
      payatReconcileFailed,
      silentExpiries,
      payatDeferred,
      payatDeferTimeouts,
      payatItnRecovered: recovered,
      payatItnSkipped: skipped,
      payatItnFailed: failed,
      durationMs: duration,
    })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: String(err), timestamp: new Date().toISOString() }))
    throw err
  }
}
