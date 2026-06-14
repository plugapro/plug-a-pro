import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'
import { PROVIDER_CREDIT_PRICE_ZAR } from '@/lib/provider-wallet'

export const metadata = buildMetadata({ title: 'Provider Credits Terms and Rules', noIndex: true })

const creditPriceLine = `1 credit = R${PROVIDER_CREDIT_PRICE_ZAR}.`

const sections = [
  {
    title: 'What provider credits are',
    body: `Plug A Pro provider credits are prepaid platform units used by approved independent service providers to accept customer-selected opportunities. ${creditPriceLine} Provider credits are not customer credits, cash, legal tender, loans, bank deposits or financial credit.`,
  },
  {
    title: 'Starter and onboarding credits',
    body: 'If your provider application is approved, Plug A Pro may award starter, promotional, onboarding, voucher or goodwill credits to help you begin accepting customer-selected opportunities. These non-purchased credits may be shown separately from purchased credits and cannot be withdrawn as cash.',
  },
  {
    title: 'Accepting a customer-selected job',
    body: `Each customer-selected opportunity you finally accept uses 1 provider credit unless the Platform states a different rule before acceptance. ${creditPriceLine} The credit is deducted only when final provider acceptance succeeds. Full customer contact details, exact address and job access notes unlock only after acceptance succeeds.`,
  },
  {
    title: 'Preview, interest, decline and expiry',
    body: 'Previewing a job, showing interest, being shortlisted, customer selection before your final acceptance, declining, expiry, failed acceptance, insufficient balance or failed payment top-up does not use provider credits.',
  },
  {
    title: 'Insufficient credits',
    body: 'If your balance is too low, you cannot accept paid matched leads until you top up or receive additional credits. You can still view allowed preview information, but full customer details remain hidden.',
  },
  {
    title: 'Top-ups and purchased credits',
    body: 'Purchased credits are added after the payment is confirmed by Plug A Pro, Pay@ / PayAt or the relevant payment process shown in the Worker Portal. Manual EFT top-ups may take longer because finance must match the payment reference.',
  },
  {
    title: 'Refunds and reversals',
    body: 'Purchased provider credits are generally non-refundable once bought, except where required by law or where Plug A Pro approves a reversal due to a clear platform or system error, duplicate payment, failed credit allocation, incorrect deduction, suspected fraud or chargeback reversal or another admin-approved exception. Approved reversals are recorded in the credits ledger.',
  },
  {
    title: 'Credits expiry',
    body: 'Purchased provider credits do not currently expire in the implemented wallet. Any future purchased-credit expiry rule requires notice and legal review. Some starter, onboarding, promotional or voucher credits may have expiry rules if stated when awarded.',
  },
  {
    title: 'Lead-credit disputes',
    body: 'You may query a lead-credit deduction where the lead was invalid, duplicated, materially in the wrong category or location, linked to an invalid customer number, not actually requested by the customer, cancelled before unlock or affected by platform error.',
  },
  {
    title: 'Audit records',
    body: 'Plug A Pro records credit purchases, allocations, deductions, reversals, payment reversals, lead unlocks, disputes and admin adjustments in wallet ledger and audit records.',
  },
  {
    title: 'Misuse and abuse',
    body: 'Plug A Pro may pause, suspend, reverse credits or block lead access where there is fraud, abuse, false information, repeated misuse or behaviour that harms customers, providers or the marketplace.',
  },
  {
    title: 'Updates to credits rules',
    body: 'Plug A Pro may update provider credits rules with notice. Continued use of the Worker Portal, WhatsApp lead actions or provider tools after notice means the updated rules apply.',
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
          Plain-language rules for provider prepaid credits, top-ups, lead acceptance and credits use.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 text-sm">
        <p>
          These rules explain how Plug A Pro provider credits work. Credits are prepaid platform units, not cash, loans,
          bank deposits, legal tender or financial credit. Your provider application must be reviewed and approved before your profile is activated.
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
