import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Credits and Wallet Policy" });

export default function CreditsPolicyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Credits and Wallet Policy</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 29 April 2026</p>

        <p>
          <strong>
            ⚠ Draft for attorney review — not yet final or enforceable. This document requires
            review by a qualified South African attorney before going live, particularly with
            respect to prepaid value rules, POPIA compliance, Consumer Protection Act implications,
            and tax/VAT treatment of credits.
          </strong>
        </p>

        <p>
          This Credits and Wallet Policy (&ldquo;Credits Policy&rdquo;) explains how credits (&ldquo;Credits&rdquo;)
          work on the Plug A Pro platform. It is part of our{" "}
          <a href="/terms">Terms of Service</a>. Words defined in the Terms have the same meaning here.
        </p>

        <h2>1. What Credits Are</h2>
        <p>
          Credits are a platform accounting mechanism that can be applied toward eligible services,
          fees, or charges on the Plug A Pro platform (&ldquo;the Platform&rdquo;). Credits:
        </p>
        <ul>
          <li>are <strong>not</strong> legal tender or a currency of any kind;</li>
          <li>are <strong>not</strong> a bank deposit, e-money, or stored-value product;</li>
          <li>are <strong>not</strong> interest-bearing;</li>
          <li>cannot be withdrawn as cash (except where Plug A Pro expressly agrees or applicable law requires it);</li>
          <li>cannot be traded, sold, gifted, or transferred between users unless Plug A Pro expressly enables this;</li>
          <li>are not redeemable for cash unless required by law.</li>
        </ul>
        <p>
          Credits are recorded in your Platform account and are visible in your wallet or account section
          of the Platform.
        </p>

        <h2>2. Types of Credits</h2>
        <p>
          The Platform uses several types of Credits. Each type has different rules for expiry, refund,
          and use. The type of Credit is always displayed in your transaction history.
        </p>

        <h3>Paid Credits (Purchased Credits)</h3>
        <p>
          Credits purchased by you using real money (via card, EFT, or other payment method processed
          through the Platform). Paid Credits represent a prepaid Platform balance you have purchased.
          Rules applying specifically to Paid Credits are marked throughout this policy.
        </p>

        <h3>Promotional Credits</h3>
        <p>
          Credits issued by Plug A Pro as part of a promotion, welcome offer, referral reward, or
          similar incentive. Promotional Credits are not purchased and have no monetary cost to you.
          They may carry shorter expiry periods and different refund treatment than Paid Credits. The
          specific conditions for any promotion are communicated at the time the Promotional Credits
          are awarded.
        </p>

        <h3>Refund Credits</h3>
        <p>
          Credits issued as a refund when a cash payment for a booking is refunded back to your Platform
          account rather than to your original payment method. Refund Credits have the same value as the
          original payment refunded. The applicable refund method (cash vs. Credits) is determined by our
          <a href="/refund-policy">Refund and Cancellation Policy</a>.
        </p>

        <h3>Goodwill Credits</h3>
        <p>
          Credits issued at Plug A Pro&apos;s discretion as a gesture of goodwill — for example, where a
          Platform error caused inconvenience. Goodwill Credits do not imply admission of liability.
        </p>

        <h3>Other Credits</h3>
        <p>
          Plug A Pro may create additional Credit types for specific programmes (for example: early
          adopter awards, loyalty rewards). The conditions for each type will be disclosed at the time
          of award.
        </p>

        <h2>3. Purchasing Credits</h2>
        <p>
          You may purchase Paid Credits where this option is offered in the Platform. When you purchase
          Credits:
        </p>
        <ul>
          <li>Payment is processed by our third-party payment processor (Peach Payments or PayFast). The processor&apos;s terms apply to the payment transaction.</li>
          <li>Credits are allocated to your account once Plug A Pro receives confirmed payment from the processor. This is typically immediate for card payments; manual EFT payments may take longer to verify.</li>
          <li>If a payment fails, is reversed, or is charged back, the Credits associated with that payment may be reversed. See section 9 (Chargebacks and Reversed Payments).</li>
          <li>Plug A Pro may delay Credit allocation where we have reasonable grounds to suspect fraud, payment risk, or abuse.</li>
          <li>Purchased Credits will be confirmed by a transaction record in your Platform account and, where applicable, a receipt.</li>
        </ul>

        <h2>4. Using Credits</h2>
        <ul>
          <li>Credits may be applied toward eligible Platform services, booking fees, or charges as displayed at checkout.</li>
          <li>Credits may be used in full or in part as payment for a Booking, depending on the booking amount and your available balance.</li>
          <li>Where the Booking total exceeds your available Credit balance, you must pay the difference using another payment method.</li>
          <li>Where the Booking total is less than your available Credit balance, the remaining Credits stay in your account (subject to any expiry rules).</li>
          <li>Credits are applied at checkout according to the Platform&apos;s allocation logic, which prioritises expiring Credits first, then Promotional Credits, then Paid Credits.</li>
          <li>Not all services or fees may be eligible for Credit payment. Eligibility is indicated at checkout.</li>
        </ul>

        <h2>5. Credit Balance and Transaction History</h2>
        <p>
          Your current Credit balance and a history of Credit transactions (top-ups, debits, refunds,
          promotional awards, expiries, and adjustments) are available in your Platform account. Each
          transaction record shows:
        </p>
        <ul>
          <li>Date and time</li>
          <li>Amount (credited or debited)</li>
          <li>Credit type (Paid, Promotional, Refund, Goodwill, etc.)</li>
          <li>Reason (e.g., booking payment, refund, promotion)</li>
          <li>Booking reference where applicable</li>
          <li>Expiry date where applicable</li>
          <li>Running balance after the transaction</li>
        </ul>
        <p>
          If you believe there is an error in your Credit balance or transaction history, contact{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a> as soon as possible.
          Plug A Pro will investigate and correct genuine errors.
        </p>

        <h2>6. Expiry of Credits</h2>

        <h3>Paid Credits</h3>
        <p>
          <strong>⚠ Attorney review required:</strong> The expiry terms for Paid Credits (i.e., credits
          purchased with real money) must be reviewed against South African prepaid voucher/value law and
          the Consumer Protection Act before any expiry policy is applied. We intend to treat Paid Credits
          as non-expiring or subject to a generous long-stop period only. Details will be confirmed here
          once the legal review is complete.
        </p>

        <h3>Promotional Credits</h3>
        <p>
          Promotional Credits may carry an expiry date. The expiry date is:
        </p>
        <ul>
          <li>Disclosed to you at the time the Promotional Credits are awarded</li>
          <li>Visible in your Credit transaction history</li>
          <li>Shown at checkout before you complete a transaction using those Credits</li>
        </ul>
        <p>
          Promotional Credits that expire are removed from your balance on the expiry date and are not
          recoverable after expiry. Plug A Pro will provide advance notification of expiry where possible.
        </p>

        <h2>7. Refunds Involving Credits</h2>

        <h3>Booking paid entirely with Credits</h3>
        <p>
          If the full booking was paid with Credits and the booking is refunded, the Credits will
          generally be returned to your Credit balance as Refund Credits. The refund will be processed
          within 5 business days of the refund decision.
        </p>

        <h3>Booking paid partly with Credits and partly with another payment method</h3>
        <p>
          Where a booking used a mix of Credits and another payment method (e.g., card):
        </p>
        <ul>
          <li>The cash/card portion is refunded to the original payment method first.</li>
          <li>The Credit portion is refunded to your Credit balance.</li>
          <li>Plug A Pro reserves the right to adjust this split in specific circumstances, subject to our Refund Policy and applicable law.</li>
        </ul>

        <h3>Promotional Credits refunds</h3>
        <p>
          Refunds for bookings paid with Promotional Credits are generally returned as Promotional
          Credits, not as cash. This is because Promotional Credits had no monetary cost to you.
        </p>

        <h3>Provider-caused refunds</h3>
        <p>
          Where a refund is required because of a Provider&apos;s failure (non-attendance, poor
          workmanship, damage), Plug A Pro may recover the refund amount from the Provider&apos;s
          future settlements or require reimbursement from the Provider under the Service Provider
          Terms. This does not delay or reduce your refund entitlement.
        </p>

        <h2>8. Cancellations Involving Credits</h2>
        <p>
          Your Credit refund on cancellation depends on who cancels and when. See the{" "}
          <a href="/refund-policy">Refund and Cancellation Policy</a> for the full cancellation
          matrix. In summary:
        </p>
        <ul>
          <li><strong>Customer cancels before Provider assignment:</strong> Full Credit refund</li>
          <li><strong>Customer cancels after Provider dispatch:</strong> Subject to call-out fee or cancellation fee; remaining Credits refunded</li>
          <li><strong>Customer no-show or no access:</strong> Provider may retain call-out fee; remaining Credits refunded</li>
          <li><strong>Provider cancels:</strong> Full Credit refund regardless of timing</li>
          <li><strong>Plug A Pro cancels for operational reasons:</strong> Full Credit refund</li>
        </ul>

        <h2>9. Chargebacks and Reversed Payments</h2>
        <p>
          If a payment you made to purchase Credits is subsequently:
        </p>
        <ul>
          <li>reversed by your bank or card issuer;</li>
          <li>subject to a chargeback (dispute raised with your payment provider);</li>
          <li>found to be fraudulent or processed without authorisation; or</li>
          <li>dishonoured for any reason,</li>
        </ul>
        <p>
          then Plug A Pro may reverse the corresponding Credit allocation from your account.
        </p>
        <p>
          If you have already used the reversed Credits for a booking, Plug A Pro may:
        </p>
        <ul>
          <li>set off the reversed amount against future Credits or Platform activity;</li>
          <li>suspend your ability to use Credits until the matter is resolved;</li>
          <li>cancel any affected pending bookings;</li>
          <li>recover the outstanding amount through other lawful means.</li>
        </ul>
        <p>
          Legitimate chargebacks (e.g., where you did not authorise the original payment) will be
          handled fairly. Contact{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a> before raising a
          chargeback where possible — many issues can be resolved directly and faster.
        </p>

        <h2>10. Fraud and Misuse</h2>
        <p>
          Plug A Pro may suspend, freeze, or forfeit Credits and/or suspend your account where we
          have reasonable grounds to believe:
        </p>
        <ul>
          <li>fraudulent activity has occurred (e.g., using stolen payment details to purchase Credits);</li>
          <li>Credits have been obtained through abuse of promotions, referral programmes, or Platform systems;</li>
          <li>multiple accounts have been created to obtain promotional Credits improperly;</li>
          <li>Credits are being used in a manner that is contrary to this Policy or the Terms.</li>
        </ul>
        <p>
          Plug A Pro will investigate concerns fairly and notify you where required. You may contact{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a> to respond to a
          suspension.
        </p>

        <h2>11. No Cash-Out</h2>
        <p>
          Credits cannot be withdrawn as cash, transferred to a bank account, or converted to any
          other form of value outside the Platform, unless Plug A Pro expressly agrees in writing or
          applicable South African law requires it.
        </p>
        <p>
          Credits cannot be transferred to another user&apos;s account unless Plug A Pro expressly
          provides this feature.
        </p>

        <h2>12. Service Providers and Credit-Funded Bookings</h2>
        <p>
          Providers accept that Bookings confirmed through the Platform may be funded in whole or in
          part by Customer Credits. Providers are paid by Plug A Pro according to the Provider settlement
          terms — their payment is not dependent on the Customer&apos;s Credit balance.
        </p>
        <p>
          Providers must not refuse a confirmed Booking solely because Credits were used as payment.
          Provider payment obligations under the Provider Terms are not affected by the Customer&apos;s
          payment method.
        </p>
        <p>
          Providers remain fully responsible for their work quality, conduct, and compliance with law
          regardless of whether Credits or cash were used for the booking.
        </p>

        <h2>13. Tax, Invoices, and Receipts</h2>
        <p>
          <strong>⚠ Tax and VAT treatment of Credit purchases and redemptions requires review by a
          South African accountant or tax advisor. The following is an operational description, not a
          tax ruling:</strong>
        </p>
        <ul>
          <li>Purchasing Credits: a Platform receipt or confirmation is issued when Credits are purchased.</li>
          <li>Redeeming Credits for a service: a service receipt or invoice is generated when a Booking is completed and paid (including Credit payment). The invoice reflects the service value.</li>
          <li>VAT treatment of Credit top-ups and redemptions is under review and will be updated once confirmed.</li>
        </ul>

        <h2>14. Platform Limitation of Liability for Credits</h2>
        <p>
          Plug A Pro administers the Credit ledger with reasonable care. Subject to applicable law:
        </p>
        <ul>
          <li>We are not responsible for loss of Credits caused by user error, fraud by third parties unknown to us, or unauthorised access to your account (where you failed to keep credentials secure).</li>
          <li>We are not responsible for Provider workmanship or non-performance merely because Credits were used for the booking.</li>
          <li>Our liability for any Credit ledger error is limited to restoring the correct Credit balance.</li>
          <li>We are not liable for the tax consequences of Credit transactions.</li>
        </ul>
        <p>
          Your statutory rights under the Consumer Protection Act and POPIA are not limited by this clause.
        </p>

        <h2>15. Changes to the Credits Policy</h2>
        <p>
          Plug A Pro may update this Credits Policy from time to time. We will notify you of material
          changes via WhatsApp or a Platform notice at least 14 days before they take effect. Changes will
          not retroactively devalue Paid Credits you have already purchased without notice and reasonable
          remedy options.
        </p>

        <h2>16. Contact</h2>
        <p>
          Credits and wallet queries: <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a><br />
          Plug A Pro — Registered in South Africa
        </p>

        <hr />
        <p>
          <em>
            This policy requires review by a qualified South African attorney before enforcement,
            particularly with respect to prepaid credit law, the Consumer Protection Act, POPIA, and
            the tax/accounting treatment of Credit transactions.
          </em>
        </p>
      </div>
    </div>
  );
}
