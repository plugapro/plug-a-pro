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
    <div className="mx-auto max-w-lg space-y-5 px-4 py-6 pb-24">
      <PageHeader
        eyebrow="Provider credits"
        title="Provider Credits"
        description={`Credits are prepaid platform units, not loans or financial credit. 1 credit = R${PROVIDER_CREDIT_PRICE_ZAR}. Credits are used only when you accept a customer-selected job.`}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/provider">Jobs</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Credits balance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">Total available credits</p>
            <p className="text-4xl font-bold tracking-normal">{summary.totalAvailableCredits}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Purchased</p>
              <p className="text-lg font-semibold">{summary.paidCredits}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Starter</p>
              <p className="text-lg font-semibold">{summary.promoCredits}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Accepts</p>
              <p className="text-lg font-semibold">{summary.estimatedLeadsUnlockable}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payfast return-URL banners */}
      {topupParam === 'success' ? (
        <AlertCallout tone="success" title="Payment submitted">
          Your credits will appear in your wallet once Payfast confirms the payment — this usually takes a few seconds.
        </AlertCallout>
      ) : null}

      {topupParam === 'cancelled' ? (
        <AlertCallout tone="warning" title="Payment not completed">
          Your wallet was not charged. Select a package below to try again.
        </AlertCallout>
      ) : null}

      {/* Manual EFT instructions (if a manual intent was just created) */}
      {instructions ? <EftInstructions instructions={instructions} /> : null}

      {/* Pay@ top-up — primary */}
      <Card>
        <CardHeader>
          <CardTitle>Top up with Pay@</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pay with a retail cash reference, QR code, or hosted payment page. 1 credit = R{PROVIDER_CREDIT_PRICE_ZAR}. Credits are issued automatically once Pay@ confirms payment.
          </p>
          <PayatPackageSelector />
        </CardContent>
      </Card>

      {/* Payfast top-up — secondary */}
      <Card>
        <CardHeader>
          <CardTitle>Pay by card with Payfast</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Use Payfast if you prefer card, instant EFT, or SCode checkout.
          </p>
          <PayfastPackageSelector />
        </CardContent>
      </Card>

      {/* Manual EFT — secondary */}
      <Card>
        <CardHeader>
          <CardTitle>Manual EFT</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Manual EFT top-ups are credited after funds are confirmed by our finance team (1–2 business days).
          </p>
          <div className="grid gap-2">
            {TOP_UP_OPTIONS.map((option) => (
              <form key={option.amountCents} action={createProviderTopUpIntentFormAction}>
                <input type="hidden" name="amountCents" value={option.amountCents} />
                <Button type="submit" variant="outline" className="h-auto w-full justify-between p-4">
                  <span className="text-left">
                    <span className="block font-semibold">{option.label}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {option.credits} Plug A Pro provider credits
                    </span>
                  </span>
                  <span>Get instructions</span>
                </Button>
              </form>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent wallet activity</CardTitle>
        </CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No wallet activity yet.
            </p>
          ) : (
            <ul>
              {ledger.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Credits use is governed by the{' '}
        <Link href={termsUrl} className="font-medium underline underline-offset-4">
          provider credits terms and rules
        </Link>
        .
      </p>
    </div>
  )
}
