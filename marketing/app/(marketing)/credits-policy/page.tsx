import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({
  title: "Provider Credits Terms and Rules",
  description:
    "Plain-language rules for Plug A Pro provider credits, top-ups, deductions, reversals and support queries.",
});

export default function CreditsPolicyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Provider Credits Terms and Rules</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 29 May 2026</p>

        <p>
          These rules apply to approved independent service providers who use Plug A Pro to receive
          and accept customer-selected opportunities. Customers do not buy these provider credits.
          Provider credits are prepaid platform units used by providers to accept eligible leads or
          jobs on Plug A Pro. They are not payment for the provider&apos;s actual work.
        </p>

        <h2>1. What provider credits are</h2>
        <p>
          <strong>1 provider credit currently equals R50.</strong> Provider credits are shown in the
          provider wallet and credits history inside the Worker Portal. They are not cash, legal
          tender, financial credit, a loan, a bank deposit, interest-bearing value or a stored-value
          bank account.
        </p>
        <p>
          Provider credits cannot be withdrawn as cash, transferred, sold, exchanged, assigned to
          another account or converted into money unless Plug A Pro expressly approves a lawful
          reversal.
        </p>

        <h2>2. Who can buy or receive credits</h2>
        <p>
          Provider credits are for approved providers only. Paid top-ups may require identity
          verification and an active provider wallet. Plug A Pro may also award starter, promotional,
          onboarding, voucher or goodwill credits. Promotional and voucher credits are separate from
          purchased credits and may have campaign-specific rules if those rules are stated when they
          are awarded.
        </p>

        <h2>3. When credits are deducted</h2>
        <p>
          A provider credit is deducted only when a customer selects a provider and that provider
          completes final acceptance of the customer-selected opportunity through the Platform,
          WhatsApp or the Worker Portal. Each accepted customer-selected opportunity currently uses
          1 provider credit unless the Platform expressly states a different rule before acceptance.
        </p>

        <h2>4. When credits are not deducted</h2>
        <ul>
          <li>Previewing a lead summary does not use credits.</li>
          <li>Showing interest does not use credits.</li>
          <li>Being shortlisted does not use credits.</li>
          <li>Customer selection before the provider&apos;s final acceptance does not use credits.</li>
          <li>Declining a lead does not use credits.</li>
          <li>Letting a lead expire does not use credits.</li>
          <li>A failed, cancelled or reversed top-up does not add credits.</li>
        </ul>

        <h2>5. Purchased credits, promo credits and voucher credits</h2>
        <p>
          Purchased credits are added only after payment is confirmed by Plug A Pro, the relevant
          payment processor (currently <strong>PayFast</strong> and <strong>Pay@ / PayAt</strong> or
          another processor shown in the Worker Portal at the time of purchase) or manual finance
          reconciliation. Promotional, starter, onboarding and voucher credits are non-purchased
          credits. They cannot be withdrawn or refunded as cash.
        </p>
        <p>
          When the Platform deducts credits for an accepted lead, promo or voucher credits may be used
          before purchased credits so the wallet ledger keeps paid and non-paid credits separate.
        </p>

        <h2>6. Refunds, reversals and disputes</h2>
        <p>
          Purchased provider credits are generally non-refundable once bought, except where required
          by law or where Plug A Pro approves a reversal because of a clear platform or system error,
          duplicate payment, failed credit allocation, incorrect deduction, suspected fraud or
          chargeback reversal or another admin-approved exception.
        </p>
        <p>
          A provider may query a lead-credit deduction where the lead was invalid, duplicated,
          materially in the wrong category or location, linked to an invalid customer number, not
          actually requested by the customer, cancelled before unlock or affected by a platform
          error. Approved lead-credit disputes are reversed through the provider wallet ledger. They
          are not customer service refunds.
        </p>

        <h2>7. Expiry</h2>
        <p>
          Purchased provider credits do not currently expire in the implemented wallet. Any future
          expiry rule for purchased credits must be communicated before it applies and requires legal
          review for CPA, ECTA and related payment/accounting treatment. Promotional, starter,
          onboarding or voucher credits may expire if a lawful expiry rule is stated when they are
          awarded.
        </p>

        <h2>8. Audit records</h2>
        <p>
          Plug A Pro records credit purchases, allocations, deductions, reversals, payment reversals,
          lead unlocks, disputes and admin adjustments in wallet ledger and audit records. These
          records help support queries, fraud review, accounting and dispute handling.
        </p>

        <h2>9. How to query a credit deduction</h2>
        <p>
          Contact support via WhatsApp or email at{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>. Include the job or lead
          reference, the deduction you are querying, the reason and any screenshots or supporting
          evidence. Plug A Pro will review the Platform record and respond with the outcome.
        </p>

        <h2>10. Changes</h2>
        <p>
          Plug A Pro may update provider credits terms with notice, subject to applicable law.
          Continued use of the Worker Portal, WhatsApp provider actions or provider tools after
          notice means the updated rules apply.
        </p>
      </div>
    </div>
  );
}
