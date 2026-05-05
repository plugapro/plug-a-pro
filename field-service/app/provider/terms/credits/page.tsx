import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'
import { PROVIDER_CREDIT_PRICE_ZAR } from '@/lib/provider-wallet'

export const metadata = buildMetadata({ title: 'Provider Credits Terms and Rules', noIndex: true })

const creditPriceLine = `1 credit = R${PROVIDER_CREDIT_PRICE_ZAR}.`

const sections = [
  {
    title: 'What provider credits are',
    body: `Plug A Pro credits are prepaid platform units used by approved service providers to accept customer-selected jobs. ${creditPriceLine} Credits are not cash, loans, or financial credit.`,
  },
  {
    title: 'Starter and onboarding credits',
    body: 'If your provider application is approved, Plug A Pro may award starter or onboarding credits to help you begin accepting customer-selected jobs. These credits appear in your credits balance and may be shown separately from purchased credits.',
  },
  {
    title: 'Accepting a customer-selected job',
    body: `Each customer-selected job you accept uses 1 credit. ${creditPriceLine} The credit is deducted only when final provider acceptance succeeds. Full customer contact details, exact address, and job access notes unlock only after acceptance succeeds.`,
  },
  {
    title: 'Preview, interest, decline, and expiry',
    body: 'Previewing a job, showing interest, being shortlisted, customer selection before your final acceptance, declining, and expiry do not use credits.',
  },
  {
    title: 'Insufficient credits',
    body: 'If your balance is too low, you cannot accept paid matched leads until you top up or receive additional credits. You can still view allowed preview information, but full customer details remain hidden.',
  },
  {
    title: 'Top-ups and purchased credits',
    body: 'Purchased credits are added after the payment is confirmed by Plug A Pro, Payfast, or the relevant payment process. Manual EFT top-ups may take longer because finance must match the payment reference.',
  },
  {
    title: 'Refunds and reversals',
    body: 'Plug A Pro may reverse or refund credits where a job is invalid, duplicated, technically failed, or qualifies under an approved support review. Refunds or reversals are recorded in the credits ledger.',
  },
  {
    title: 'Credits expiry',
    body: 'Some starter, onboarding, or promotional credits may have expiry rules if stated when awarded. Purchased-credit expiry rules, if introduced, will be communicated before they apply.',
  },
  {
    title: 'Misuse and abuse',
    body: 'Plug A Pro may pause, suspend, reverse credits, or block lead access where there is fraud, abuse, false information, repeated misuse, or behaviour that harms customers, providers, or the marketplace.',
  },
  {
    title: 'Updates to credits rules',
    body: 'Plug A Pro may update provider credits rules with notice. Continued use of the Worker Portal, WhatsApp lead actions, or provider tools after notice means the updated rules apply.',
  },
  {
    title: 'Support and escalation',
    body: 'If you believe credits were used incorrectly, contact Plug A Pro support from WhatsApp or the Worker Portal with the job reference and a short explanation.',
  },
]

export default function ProviderCreditTermsPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Plug A Pro</p>
        <h1 className="text-2xl font-semibold tracking-normal">Provider Credits Terms and Rules</h1>
        <p className="text-sm text-muted-foreground">
          Plain-language rules for provider prepaid credits, top-ups, lead acceptance, and credits use.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 text-sm">
        <p>
          These rules explain how Plug A Pro provider credits work. Credits are prepaid platform units, not cash, loans,
          or financial credit. Your provider application must be reviewed and approved before your profile is activated.
        </p>
      </div>

      <section className="space-y-4">
        {sections.map((section) => (
          <article key={section.title} className="space-y-1 border-b pb-4 last:border-b-0">
            <h2 className="text-base font-semibold">{section.title}</h2>
            <p className="text-sm leading-6 text-muted-foreground">{section.body}</p>
          </article>
        ))}
      </section>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p>
          This page is part of the provider onboarding and credits process. For account-specific questions, use WhatsApp
          support or the Worker Portal.
        </p>
      </div>

      <div>
        <Link href="/provider-sign-in" className="text-sm font-medium underline underline-offset-4">
          Go to Worker Portal sign-in
        </Link>
      </div>
    </main>
  )
}
