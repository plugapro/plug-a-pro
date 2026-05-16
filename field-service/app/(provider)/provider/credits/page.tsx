export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCallout } from '@/components/shared/AlertCallout'
import { PageHeader } from '@/components/shared/PageHeader'
import { buildMetadata } from '@/lib/metadata'
import { getProviderTermsUrl } from '@/lib/provider-credit-copy'
import { PROVIDER_CREDIT_PRICE_CENTS, PROVIDER_CREDIT_PRICE_ZAR } from '@/lib/provider-wallet'
import {
  createProviderTopUpIntentFormAction,
  getProviderTopUpIntentInstructions,
  getProviderWalletLedger,
  getProviderWalletSummary,
  type ProviderTopUpIntentInstructions,
  type ProviderWalletLedgerItem,
} from './actions'
import { PayatPackageSelector } from './PayatPackageSelector'
import { PayfastPackageSelector } from './PayfastPackageSelector'

export const metadata = buildMetadata({ title: 'Provider Credits', noIndex: true })

const TOP_UP_AMOUNTS_CENTS = [10_000, 20_000, 50_000] as const
const TOP_UP_OPTIONS = TOP_UP_AMOUNTS_CENTS.map((amountCents) => ({
  amountCents,
  label: `R${amountCents / 100}`,
  credits: amountCents / PROVIDER_CREDIT_PRICE_CENTS,
}))

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function signedCredits(value: number) {
  return `${value > 0 ? '+' : ''}${value} credit${Math.abs(value) === 1 ? '' : 's'}`
}

function EftInstructions({ instructions }: { instructions: ProviderTopUpIntentInstructions }) {
  return (
    <Card className="border-primary/25 bg-primary/5">
      <CardHeader>
        <CardTitle>Manual EFT instructions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border bg-background/80 p-3">
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="font-semibold">{instructions.amountFormatted}</p>
          </div>
          <div className="rounded-lg border bg-background/80 p-3">
            <p className="text-xs text-muted-foreground">Credits</p>
            <p className="font-semibold">{instructions.creditsToIssue}</p>
          </div>
        </div>

        <div className="rounded-lg border border-primary/30 bg-background p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Payment reference</p>
          <p className="mt-1 text-xl font-bold tracking-wide">{instructions.paymentReference}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Use this exact reference so finance can match your deposit.
          </p>
        </div>

        <dl className="grid gap-2 rounded-lg border bg-background/80 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Account name</dt>
            <dd className="text-right font-medium">{instructions.bankAccount.accountName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Bank</dt>
            <dd className="text-right font-medium">{instructions.bankAccount.bankName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Account number</dt>
            <dd className="text-right font-medium">{instructions.bankAccount.accountNumber}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Branch code</dt>
            <dd className="text-right font-medium">{instructions.bankAccount.branchCode}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Account type</dt>
            <dd className="text-right font-medium">{instructions.bankAccount.accountType}</dd>
          </div>
        </dl>

        {instructions.expiresAt ? (
          <p className="text-xs text-muted-foreground">
            This payment reference expires {formatDateTime(instructions.expiresAt)}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ActivityRow({ item }: { item: ProviderWalletLedgerItem }) {
  const positive = item.signedAmountCredits > 0

  return (
    <li className="flex items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="font-medium">{item.label}</p>
        <p className="text-xs text-muted-foreground">
          {item.detail} · {formatDateTime(item.occurredAt)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Balance after: {item.balanceAfterPaidCredits + item.balanceAfterPromoCredits} credits
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={
            positive
              ? 'font-semibold tabular-nums text-[var(--tone-success-fg)]'
              : 'font-semibold tabular-nums text-foreground'
          }
        >
          {signedCredits(item.signedAmountCredits)}
        </p>
        <Badge variant="outline" className="mt-1">
          {item.creditType === 'PAID' ? 'Purchased' : 'Starter'}
        </Badge>
      </div>
    </li>
  )
}

export default async function ProviderCreditsPage({
  searchParams,
}: {
  searchParams?: Promise<{ intent?: string; topup?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const [summary, ledger, instructions] = await Promise.all([
    getProviderWalletSummary(),
    getProviderWalletLedger(),
    resolvedSearchParams.intent
      ? getProviderTopUpIntentInstructions(resolvedSearchParams.intent)
      : Promise.resolve(null),
  ])

  const topupParam = resolvedSearchParams.topup
  const termsUrl = getProviderTermsUrl()

  return (
    <div className="min-h-screen pb-32 screen-enter">
      {/* Page header */}
      <div className="px-[18px] pt-[60px] pb-4">
        <div className="text-[28px] font-bold tracking-[-0.025em]" style={{ color: 'var(--ink)' }}>Credits</div>
      </div>

      {/* Credits hero card — dark ink background with purple halo */}
      <div className="px-[18px]">
        <div className="relative overflow-hidden rounded-[24px] p-5"
             style={{ background: 'var(--ink)', color: 'var(--card)' }}>
          {/* Radial halo */}
          <div aria-hidden className="absolute right-[-40px] top-[-40px] w-[220px] h-[220px] rounded-full opacity-30"
               style={{ background: '#8B3FE8', filter: 'blur(50px)' }} />

          <div className="relative">
            <div className="text-[11px] font-bold tracking-[0.08em] uppercase opacity-60 mb-1">
              Available credits
            </div>
            <div className="text-[48px] font-bold tracking-[-0.03em] leading-none mb-1">
              {summary.totalAvailableCredits}
            </div>
            <div className="text-[12.5px] opacity-60 mb-5">
              {summary.paidCredits} purchased · {summary.promoCredits} starter · {summary.estimatedLeadsUnlockable} accepts available
            </div>

            <div className="flex gap-2.5">
              <Link href="/provider/credits#topup"
                    className="flex-1 h-10 rounded-[12px] flex items-center justify-center text-[13px] font-semibold"
                    style={{ background: 'rgba(255,255,255,0.15)', color: 'var(--card)' }}>
                Top up
              </Link>
              <Link href={termsUrl}
                    className="flex-1 h-10 rounded-[12px] flex items-center justify-center text-[13px] font-semibold"
                    style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--card)' }}>
                Terms
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* What credits cost */}
      <div className="px-[18px] mt-4">
        <div className="rounded-[20px] px-4 py-3"
             style={{ background: 'rgba(139,63,232,0.06)', boxShadow: 'inset 0 0 0 1px rgba(139,63,232,0.15)' }}>
          <div className="text-[12.5px]" style={{ color: 'var(--ink)' }}>
            Credits are prepaid platform units, not loans. 1 credit = R{PROVIDER_CREDIT_PRICE_ZAR}. Credits are only used when you accept a customer-selected job.
          </div>
        </div>
      </div>

      {/* Top-up return banners */}
      {topupParam === 'success' && (
        <div className="px-[18px] mt-4">
          <AlertCallout tone="success" title="Payment submitted">
            Your credits will appear in your wallet once payment is confirmed — usually a few seconds.
          </AlertCallout>
        </div>
      )}
      {topupParam === 'failed' && (
        <div className="px-[18px] mt-4">
          <AlertCallout tone="danger" title="Payment failed">
            Your wallet was not charged. Please try again or choose a different payment method.
          </AlertCallout>
        </div>
      )}
      {topupParam === 'cancelled' && (
        <div className="px-[18px] mt-4">
          <AlertCallout tone="warning" title="Payment not completed">
            Your wallet was not charged. Select a package below to try again.
          </AlertCallout>
        </div>
      )}

      {/* Manual EFT instructions (if just created) */}
      {instructions && (
        <div className="px-[18px] mt-4">
          <EftInstructions instructions={instructions} />
        </div>
      )}

      {/* Top up with Pay@ */}
      <div className="px-[18px] mt-6" id="topup">
        <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3" style={{ color: 'var(--ink-mute)' }}>
          Top up with Pay@
        </div>
        <div className="rounded-[20px] overflow-hidden"
             style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <div className="px-4 pt-4 pb-1">
            <div className="text-[12.5px]" style={{ color: 'var(--ink-mute)' }}>
              Pay with a retail cash reference, QR code, or hosted payment page. 1 credit = R{PROVIDER_CREDIT_PRICE_ZAR}. Credits are issued automatically once Pay@ confirms payment.
            </div>
          </div>
          <div className="px-4 pb-4 mt-3">
            <PayatPackageSelector />
          </div>
        </div>
      </div>

      {/* Pay by card with Payfast */}
      <div className="px-[18px] mt-4">
        <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3" style={{ color: 'var(--ink-mute)' }}>
          Pay by card (Payfast)
        </div>
        <div className="rounded-[20px] overflow-hidden"
             style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <div className="px-4 pt-4 pb-1">
            <div className="text-[12.5px]" style={{ color: 'var(--ink-mute)' }}>
              Use Payfast if you prefer card, instant EFT, or SCode checkout.
            </div>
          </div>
          <div className="px-4 pb-4 mt-3">
            <PayfastPackageSelector />
          </div>
        </div>
      </div>

      {/* Manual EFT */}
      <div className="px-[18px] mt-4">
        <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3" style={{ color: 'var(--ink-mute)' }}>
          Manual EFT
        </div>
        <div className="rounded-[20px] overflow-hidden"
             style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <div className="px-4 pt-4 pb-1">
            <div className="text-[12.5px]" style={{ color: 'var(--ink-mute)' }}>
              Manual EFT top-ups are credited after funds are confirmed by our finance team (1–2 business days).
            </div>
          </div>
          <div className="px-4 pb-4 mt-3 space-y-2">
            {TOP_UP_OPTIONS.map((option) => (
              <form key={option.amountCents} action={createProviderTopUpIntentFormAction}>
                <input type="hidden" name="amountCents" value={option.amountCents} />
                <button type="submit"
                        className="w-full flex items-center justify-between px-4 py-3 rounded-[14px] text-left"
                        style={{
                          background: 'var(--card-alt)',
                          boxShadow: 'inset 0 0 0 1px var(--border)',
                          color: 'var(--ink)',
                        }}>
                  <div>
                    <div className="text-[14px] font-semibold">{option.label}</div>
                    <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>
                      {option.credits} Plug A Pro provider credits
                    </div>
                  </div>
                  <div className="text-[12.5px] font-semibold" style={{ color: '#8B3FE8' }}>
                    Get instructions
                  </div>
                </button>
              </form>
            ))}
          </div>
        </div>
      </div>

      {/* Wallet activity */}
      <div className="px-[18px] mt-6">
        <div className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3" style={{ color: 'var(--ink-mute)' }}>
          Recent wallet activity
        </div>
        <div className="rounded-[20px] overflow-hidden"
             style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          {ledger.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--ink-mute)' }}>
              No wallet activity yet.
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {ledger.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Terms footer */}
      <div className="px-[18px] mt-6 text-center">
        <div className="text-[12px]" style={{ color: 'var(--ink-soft)' }}>
          Credit use is governed by the{' '}
          <Link href={termsUrl} className="underline underline-offset-4" style={{ color: 'var(--ink-mute)' }}>
            provider credits terms and rules
          </Link>
          .
        </div>
      </div>
    </div>
  )
}
