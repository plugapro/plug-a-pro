import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Provider Credits Terms and Rules" });

export default function CreditsPolicyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Provider Credits Terms and Rules</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 5 May 2026</p>

        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fbbf24",
            borderRadius: "6px",
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#92400e" }}>
            <strong>Draft — pending attorney review.</strong> This page is provided as plain-language
            guidance about how Plug A Pro provider credits work. It does not constitute legal advice.
            Providers with questions about their rights under South African law should seek independent
            legal advice. This page will be updated once reviewed by a qualified South African attorney.
          </p>
        </div>

        <p>
          Plug A Pro credits are prepaid platform units used by approved service providers to accept
          customer-selected jobs. Credits are not cash, loans, financing arrangements, or financial
          credit of any kind.
        </p>

        <h2>1. Credits value</h2>
        <p>
          <strong>1 credit = R50.</strong> Credits are displayed in the provider wallet and credits
          history inside the Worker Portal. The credits value is set by Plug A Pro and may change
          with reasonable notice communicated through the Worker Portal or WhatsApp.
        </p>

        <h2>2. When credits are used</h2>
        <p>
          Credits are consumed only when a customer selects a provider and that provider accepts the
          selected job. Each accepted customer-selected job uses 1 credit.
        </p>
        <ul>
          <li>Previewing a lead does not use credits.</li>
          <li>Showing interest does not use credits.</li>
          <li>Being shortlisted does not use credits.</li>
          <li>Customer selection before provider acceptance does not use credits.</li>
          <li>Declining or expiry does not use credits.</li>
        </ul>

        <h2>3. Buying and receiving credits</h2>
        <p>
          Providers may buy credits or receive starter/onboarding credits where offered by Plug A Pro.
          Purchased credits are added after payment is confirmed. Starter or promotional credits may
          have separate rules communicated when they are awarded. Credits have no cash value and cannot
          be refunded except as described in section 8 below.
        </p>

        <h2>4. Credits are not financial credit</h2>
        <p>
          Plug A Pro does not lend money, advance funds, run credit bureau checks, or provide a
          credit facility through provider credits. Credits cannot be withdrawn as cash, transferred
          to another person, sold, or treated as a bank deposit or loan. Plug A Pro is not a credit
          provider as defined in the National Credit Act 34 of 2005.
        </p>

        <h2>5. Consumer Protection Act</h2>
        <p>
          These terms are subject to the Consumer Protection Act 68 of 2008 (CPA) to the extent that
          providers qualify as consumers under the CPA. Credits packages sold to providers who are
          natural persons and who purchase credits for personal use, or for use in a business with an
          annual turnover below the CPA threshold, may attract CPA protections including the right to
          receive fair and honest dealing and the right to cancel a transaction in certain circumstances.
          Nothing in these terms limits rights that cannot be excluded by law.
        </p>

        <h2>6. Credits history and support</h2>
        <p>
          Providers can view their credits balance and credits history in the Worker Portal. Credits
          history shows when credits were issued, used, or adjusted, along with the job reference
          linked to each use.
        </p>

        <h2>7. Disputes and incorrect charges</h2>
        <p>
          If you believe credits were used incorrectly — for example, a credit was deducted but the
          job acceptance did not complete — contact Plug A Pro support with the job reference and a
          short explanation. Plug A Pro will review disputes within a reasonable time and may restore
          credits if a platform error is confirmed. Credits are not restored for change-of-mind
          cancellations after acceptance, or for jobs where the provider accepted and the booking was
          later cancelled by the customer.
        </p>
        <p>
          Chargebacks raised through a payment provider against a credits purchase may result in the
          suspension of the provider account pending investigation. Fraudulent chargebacks may be
          referred to law enforcement.
        </p>

        <h2>8. Refunds</h2>
        <p>
          Credits purchases are generally non-refundable once credits have been issued to the wallet.
          Where a payment is processed but credits are not issued due to a platform error, Plug A Pro
          will issue the credits or refund the payment within a reasonable time. Providers who cancel
          their accounts with unused credits in their wallet may request a refund by contacting
          support; Plug A Pro will assess refund requests at its discretion and in line with
          applicable law.
        </p>

        <h2>9. Privacy and POPIA</h2>
        <p>
          Plug A Pro processes provider payment information and credits history as a responsible party
          under the Protection of Personal Information Act 4 of 2013 (POPIA). Payment data collected
          for credits purchases is used only to process the transaction and maintain an accurate
          credits ledger. Plug A Pro does not sell provider payment data to third parties. For the
          full privacy policy, see our{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>

        <h2>10. Tax treatment</h2>
        <p>
          Providers are responsible for their own tax obligations arising from income earned through
          jobs accepted on Plug A Pro. Credits purchases may attract VAT in accordance with South
          African VAT law. A tax invoice for credits purchases is available on request. Plug A Pro
          does not provide tax advice; providers should consult a registered tax practitioner if
          uncertain about their obligations.
        </p>

        <h2>11. Changes to these terms</h2>
        <p>
          Plug A Pro may update provider credits terms and rules with reasonable notice. Notice will
          be given through the Worker Portal, WhatsApp, or email where a provider email address is
          on file. Continued use of the Worker Portal, WhatsApp provider actions, or provider tools
          after the notice period means the updated rules apply.
        </p>
      </div>
    </div>
  );
}
