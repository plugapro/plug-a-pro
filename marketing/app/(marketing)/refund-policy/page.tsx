import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({
  title: "Refunds & Cancellations",
  description:
    "How refunds, cancellations and rescheduling work for Plug A Pro bookings.",
});

export default function RefundPolicyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Refunds &amp; Cancellations</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>
          This policy explains when you can cancel a booking, when fees apply and
          how refunds are processed. It forms part of our{" "}
          <a href="/terms">Terms of Service</a>.
        </p>

        <p>
          This section explains how cancellations, customer service payment refunds, provider credit
          reversals and disputes are handled on Plug A Pro. Your statutory rights under South African
          law, including the Consumer Protection Act 68 of 2008, apply throughout and override this
          section where required by law.
        </p>

        <h2>27.1 Platform role</h2>
        <p>
          Plug A Pro is a platform that helps customers find and book independent service providers.
          The service contract for the actual work is between the customer and the independent provider.
          Plug A Pro may facilitate intake, matching, quotes, communication, job records, support,
          provider credits and payments where implemented. Plug A Pro does not perform the service itself.
        </p>

        <h2>27.2 What Plug A Pro can and cannot refund</h2>
        <ul>
          <li><strong>Platform-facilitated customer payments:</strong> where Plug A Pro handled the customer payment, Plug A Pro may process or facilitate a refund according to this section, the Platform record, payment processor rules and applicable law.</li>
          <li><strong>Direct or off-platform payments:</strong> where the customer paid the provider directly, Plug A Pro can review the dispute record and support communication, but cannot refund money it never handled.</li>
          <li><strong>Provider credit purchases:</strong> provider credit reversals are handled under the <a href="/credits-policy">Provider Credits Terms and Rules</a>. They are separate from customer service payment refunds.</li>
          <li><strong>Provider lead-credit deductions:</strong> a lead-credit reversal restores provider credits in the provider wallet ledger where approved. It is not a refund to the customer.</li>
          <li><strong>Provider settlements:</strong> where Plug A Pro facilitated payment to a provider, provider settlement deductions may apply for provider-caused failures, refunds, chargebacks, fraud, no-shows or other breaches under the Service Provider Terms (§ 28).</li>
        </ul>

        <h2>27.3 How to request help</h2>
        <p>
          Contact support via WhatsApp or email at{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>. Include the booking, job,
          payment or lead reference; the reason for the cancellation, refund, reversal or dispute;
          and supporting evidence such as photos, screenshots, written quotes, job notes or messages.
          We aim to acknowledge requests within 1 business day and provide a decision or next step
          within 5 business days. Complex disputes may take longer where both sides need to respond.
        </p>

        <h2>27.4 Customer cancellation scenarios</h2>
        <p><strong>Before a provider is assigned or selected:</strong> if Plug A Pro facilitated payment and no provider has been assigned or selected, the customer will generally receive a full refund to the original payment method, subject to payment processor timing and applicable law.</p>
        <p><strong>After provider assignment or selection, but before dispatch:</strong> the customer will generally receive a refund less any cancellation or call-out fee that was clearly disclosed and approved in the quote or booking record, subject to applicable law.</p>
        <p><strong>After the provider is en route, has arrived or cannot access the site:</strong> a disclosed call-out fee, travel cost or reasonable preparation cost may be deducted where the Platform record supports it and the fee was properly disclosed. Customers must provide accurate address details, site access and a reasonably safe site.</p>
        <p><strong>Incorrect customer information:</strong> where work cannot proceed because the customer supplied materially incorrect information, Plug A Pro may facilitate a partial refund, settlement adjustment or cancellation outcome based on the quote, job record, provider evidence and applicable law.</p>

        <h2>27.5 Provider-caused cancellations and failures</h2>
        <p>
          If a provider cancels, does not arrive, lacks the required tools, skills, licence or
          availability or otherwise causes the job to fail, the customer may be entitled to a full or
          partial refund where Plug A Pro facilitated payment. Provider-caused failures are recorded and
          may result in provider suspension, removal, lead-credit consequences or settlement deductions.
        </p>

        <h2>27.6 Quality complaints and incomplete work</h2>
        <p>
          The provider is responsible for workmanship, site conduct, tools, licensing, insurance, safety
          compliance and legal compliance. Plug A Pro will facilitate a support process by reviewing the
          quote, written approvals, photos, job notes, WhatsApp messages, status updates and provider
          response. Where the Platform record supports the complaint and Plug A Pro facilitated payment,
          possible outcomes include rework discussions, full or partial refund, provider settlement hold,
          provider settlement deduction or account action. Plug A Pro does not become the provider of
          the service and does not guarantee workmanship or outcome unless expressly stated otherwise.
        </p>

        <h2>27.7 Extra work</h2>
        <p>
          Customers must approve extras in writing through the Platform before the provider performs
          that extra work. If extra work was approved and paid for but not completed, the customer may
          be entitled to a refund for the unperformed approved extras where Plug A Pro facilitated that
          payment. Verbal or off-platform extras are harder to support and may be treated as a direct
          customer-provider dispute.
        </p>

        <h2>27.8 Fraud, abuse, chargebacks and unsafe conduct</h2>
        <p>
          Plug A Pro may delay, refuse, reverse or investigate a refund, credit reversal or settlement
          where there is suspected fraud, abuse, fabricated evidence, unlawful conduct, payment reversal,
          chargeback, unsafe site conduct or breach of these Terms. Payment processor chargeback rules
          may override normal Platform timing.
        </p>

        <h2>27.9 Provider credit purchase reversals</h2>
        <p>
          Provider credit purchase reversals are separate from customer refunds. Purchased provider
          credits are generally non-refundable once bought, except where required by law or where Plug
          A Pro approves a reversal due to a clear platform or system error, duplicate payment, failed
          credit allocation, incorrect deduction, suspected fraud or chargeback reversal or another
          admin-approved exception.
        </p>

        <h2>27.10 Provider lead-credit deduction disputes</h2>
        <p>
          Providers may query a lead-credit deduction where the lead was invalid, duplicated, materially
          in the wrong category or location, linked to an invalid customer number, not actually requested
          by the customer, cancelled before unlock or affected by platform error. Approved disputes are
          restored as provider credits through the wallet ledger.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about a refund:{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a> or WhatsApp{" "}
          <a href="https://wa.me/27693552447">+27 69 355 2447</a>.
        </p>
      </div>
    </div>
  );
}
