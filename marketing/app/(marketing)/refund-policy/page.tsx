import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Refund and Cancellation Policy" });

export default function RefundPolicyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Refund and Cancellation Policy</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 29 April 2026</p>

        <p>
          This Refund and Cancellation Policy (&ldquo;Policy&rdquo;) explains what happens when a booking
          is cancelled or a refund is requested on the Plug A Pro platform. It is part of our{" "}
          <a href="/terms">Terms of Service</a>. Your rights under the{" "}
          <strong>Consumer Protection Act 68 of 2008 (&ldquo;CPA&rdquo;)</strong> apply throughout and
          are not excluded by this Policy.
        </p>

        <h2>1. How to Request a Cancellation or Refund</h2>
        <p>
          Contact us via WhatsApp or email at{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>. Please include:
        </p>
        <ul>
          <li>Your booking reference number</li>
          <li>The reason for the cancellation or refund request</li>
          <li>Any supporting evidence (photos, screenshots, notes)</li>
        </ul>
        <p>
          We aim to acknowledge cancellation and refund requests within 1 business day and to make a
          decision within 5 business days. Complex disputes involving service quality may take longer
          to investigate.
        </p>

        <h2>2. Cancellation Scenarios and Outcomes</h2>
        <p>
          Your refund entitlement depends on who cancels, when, and what stage the booking is at.
        </p>

        <h3>Scenario A — Customer cancels before Provider is assigned</h3>
        <ul>
          <li><strong>Customer refund:</strong> Full refund to original payment method (or Credits if paid with Credits)</li>
          <li><strong>Provider:</strong> Not affected (not yet assigned)</li>
          <li><strong>Processing time:</strong> 5–7 business days for card/EFT; Credits returned within 24 hours</li>
        </ul>

        <h3>Scenario B — Customer cancels after Provider is assigned but before Provider dispatches</h3>
        <ul>
          <li><strong>Customer refund:</strong> Full refund to original payment method, less any applicable call-out or cancellation fee disclosed in the Quote. If no fee was stated, full refund.</li>
          <li><strong>Provider:</strong> May receive a partial cancellation allowance if Plug A Pro&apos;s policy provides for this</li>
          <li><strong>Processing time:</strong> 5–7 business days</li>
        </ul>

        <h3>Scenario C — Customer cancels after Provider has dispatched (is en route or has arrived)</h3>
        <ul>
          <li><strong>Customer refund:</strong> Full refund less any call-out fee disclosed in the Quote, and less any reasonable travel or preparatory costs incurred by the Provider as stated in the Quote</li>
          <li><strong>Provider:</strong> Entitled to call-out fee as quoted, where applicable</li>
          <li><strong>Processing time:</strong> 5–7 business days after call-out fee deduction is confirmed</li>
        </ul>

        <h3>Scenario D — Customer not available / no access / unsafe site</h3>
        <ul>
          <li><strong>Customer refund:</strong> Refund less call-out fee if Provider arrived but could not access the site. If no call-out fee was quoted, the parties bear their own costs.</li>
          <li><strong>Provider:</strong> Entitled to quoted call-out fee where Provider arrived and attempted to access the site</li>
          <li><strong>Note:</strong> Customers must ensure the site is accessible and safe. Plug A Pro reserves the right to reduce or withhold a refund where the Customer&apos;s failure prevented the service.</li>
        </ul>

        <h3>Scenario E — Provider cancels</h3>
        <ul>
          <li><strong>Customer refund:</strong> Full refund to original payment method (or Credits). No cancellation fee applies to the Customer.</li>
          <li><strong>Provider:</strong> Provider cancellation is recorded and may affect Provider standing on the Platform. Plug A Pro may deduct from Provider settlement for associated Platform costs, per the Service Provider Terms.</li>
          <li><strong>Processing time:</strong> 5–7 business days for card/EFT; Credits returned within 24 hours</li>
        </ul>

        <h3>Scenario F — Provider no-show</h3>
        <ul>
          <li><strong>Customer refund:</strong> Full refund to original payment method (or Credits)</li>
          <li><strong>Provider:</strong> No-show is recorded. Provider may be suspended or removed from the Platform for repeated no-shows. Plug A Pro may withhold Provider settlement where applicable.</li>
          <li><strong>Processing time:</strong> 5–7 business days for card/EFT; Credits returned within 24 hours</li>
        </ul>

        <h3>Scenario G — Work cannot proceed due to incorrect Customer information</h3>
        <ul>
          <li><strong>Customer refund:</strong> Refund less call-out fee (if Provider arrived) or less a cancellation fee (if Provider was preparing based on incorrect information). Admin will assess on the evidence.</li>
          <li><strong>Provider:</strong> Entitled to compensation for reasonable preparatory costs or call-out, where supported by the booking record</li>
        </ul>

        <h3>Scenario H — Work cannot proceed because Provider lacks required tools, skills, or materials</h3>
        <ul>
          <li><strong>Customer refund:</strong> Full refund. This is Provider-caused failure.</li>
          <li><strong>Provider:</strong> No payout. Platform may take disciplinary action.</li>
        </ul>

        <h3>Scenario I — Job completed but Customer complains about quality</h3>
        <ul>
          <li><strong>Customer refund:</strong> Not automatic. Plug A Pro will review the complaint, booking record, photos, and Provider response. Refund, partial refund, credit, or rework may be offered depending on evidence and CPA obligations.</li>
          <li><strong>Provider:</strong> Must cooperate with the complaint review. May be required to redo work at no extra charge where workmanship was defective. Provider is liable for defective work under the CPA.</li>
          <li><strong>Timeline:</strong> Plug A Pro aims to respond within 5 business days. Complex cases may take longer.</li>
        </ul>

        <h3>Scenario J — Job partially completed</h3>
        <ul>
          <li><strong>Customer refund:</strong> Pro-rated refund for the unperformed portion, assessed against the Quote and job record</li>
          <li><strong>Provider:</strong> Payment for completed portion only, subject to evidence and Customer agreement</li>
        </ul>

        <h3>Scenario K — Extra work approved by Customer but not completed</h3>
        <ul>
          <li><strong>Customer refund:</strong> Full refund of the approved extras that were not performed</li>
        </ul>

        <h3>Scenario L — Plug A Pro cancels for operational reasons</h3>
        <ul>
          <li><strong>Customer refund:</strong> Full refund to original payment method (or Credits). No penalty to Customer.</li>
          <li><strong>Provider:</strong> Not penalised for Plug A Pro-initiated cancellations</li>
        </ul>

        <h3>Scenario M — Fraudulent or abusive booking</h3>
        <ul>
          <li><strong>Customer refund:</strong> Determined by Plug A Pro admin investigation. Where the Customer committed fraud, no refund may be due, and account suspension may apply.</li>
          <li><strong>Provider:</strong> Where fraud involved a Provider, Provider may face deduction, suspension, or removal.</li>
        </ul>

        <h3>Scenario N — Force majeure or unsafe conditions</h3>
        <ul>
          <li><strong>Customer refund:</strong> Full refund where the booking cannot proceed due to genuinely unforeseeable circumstances beyond either party&apos;s control (e.g., natural disaster, declared state of emergency, dangerous site conditions not caused by either party)</li>
          <li><strong>Provider:</strong> Not penalised</li>
        </ul>

        <h2>3. Refund Methods</h2>

        <h3>Paid by card or EFT through the Platform</h3>
        <p>
          Refunds for card and EFT payments are returned to the original payment method, subject to payment
          processor processing times (typically 5–7 business days for card; up to 10 business days for EFT).
        </p>

        <h3>Paid with Credits</h3>
        <p>
          Refunds for Credits-funded bookings are returned to your Credits balance as Refund Credits. See
          the <a href="/credits-policy">Provider Credits Terms and Rules</a> for full details.
        </p>

        <h3>Mixed payment (Credits + card/EFT)</h3>
        <p>
          Where a booking used a mix of Credits and another payment method, the cash/card portion is
          refunded to the original payment method first, and the Credit portion is returned to your Credit
          balance.
        </p>

        <h2>4. Service Quality Complaints</h2>
        <p>
          If you are not satisfied with the quality of work performed, contact us as soon as possible
          after the job — ideally within 3 days of completion. Delay in reporting may reduce our ability
          to investigate and assist.
        </p>
        <p>
          Provide: a description of the problem, photos if available, and what remedy you are seeking
          (redo, partial refund, full refund).
        </p>
        <p>
          The service contract is between you and the Provider. Under the Consumer Protection Act,
          Providers are responsible for defective workmanship. Plug A Pro will facilitate the
          complaints process, review available evidence, and may withhold Provider payment or require
          rework where the complaint is upheld. Plug A Pro does not take over the Provider&apos;s
          liability for their own work.
        </p>

        <h2>5. Your CPA Rights</h2>
        <p>
          Under the Consumer Protection Act 68 of 2008, you may be entitled to:
        </p>
        <ul>
          <li>Cancel certain service agreements within 5 business days of entering into them under certain conditions</li>
          <li>A remedy where goods or services are defective, substandard, or not as described</li>
          <li>Fair and honest dealings from Providers</li>
          <li>Access to our complaints process</li>
        </ul>
        <p>
          If you believe a Provider has engaged in conduct that violates the CPA, you may also approach the
          National Consumer Commission at{" "}
          <a href="https://www.thencc.gov.za" target="_blank" rel="noopener noreferrer">thencc.gov.za</a>.
        </p>

        <h2>6. Contact</h2>
        <p>
          Cancellations and refunds: <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a><br />
          Plug A Pro — Registered in South Africa
        </p>
      </div>
    </div>
  );
}
