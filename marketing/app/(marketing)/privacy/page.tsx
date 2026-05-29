import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "How Plug A Pro handles customer, provider, job, WhatsApp, payment, credit, support, analytics, and platform data.",
  noIndex: false,
});

export default function PrivacyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 29 May 2026</p>

        <p>
          Plug A Pro operates the marketplace platform at <strong>plugapro.co.za</strong>,{" "}
          <strong>app.plugapro.co.za</strong>, the PWA, and our WhatsApp booking and provider
          communication flows. This Privacy Policy explains how we collect, use, store, protect, and
          share personal information under the Protection of Personal Information Act 4 of 2013
          (&ldquo;POPIA&rdquo;) and other applicable South African law.
        </p>

        <p>
          <em>
            This policy should be read with our <a href="/terms">Terms of Service</a>,{" "}
            <a href="/provider-terms">Service Provider Terms</a>,{" "}
            <a href="/refund-policy">Refund and Cancellation Policy</a>, and{" "}
            <a href="/credits-policy">Provider Credits Terms and Rules</a>.
          </em>
        </p>

        <h2>1. Responsible party and contact</h2>
        <p>
          Plug A Pro is the responsible party for personal information collected through the Platform.
          Privacy requests can be sent to{" "}
          <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a>.
        </p>

        <h2>2. Information we collect from customers</h2>
        <ul>
          <li><strong>Identity and contact:</strong> name where provided, WhatsApp phone number, account or session identifiers.</li>
          <li><strong>Service address:</strong> street address, unit or complex details, suburb, city, province, postal code, location node, and access notes.</li>
          <li><strong>Job request details:</strong> category, subcategory, title, description, urgency, preferred date or time window, budget preference, provider preference, max call-out fee, required skills or certifications, and other instructions.</li>
          <li><strong>Photos and job evidence:</strong> uploaded customer photos, preview-safety choices, captions, job notes, approvals, signatures, completion records, reviews, and ratings.</li>
          <li><strong>Communication records:</strong> WhatsApp messages, PWA messages, support messages, delivery status, message metadata, and call or dispute notes where captured.</li>
          <li><strong>Payment records:</strong> payment references, payment status, receipts, processor responses, refunds, chargebacks, and reconciliation data where Plug A Pro facilitates payment. We do not store card numbers.</li>
          <li><strong>Support and dispute records:</strong> complaints, evidence, decisions, refunds, provider responses, and platform support notes.</li>
        </ul>

        <h2>3. Information we collect from providers</h2>
        <ul>
          <li><strong>Identity and contact:</strong> full name, WhatsApp phone number, email address where provided, identity number or verification data where required, and account identifiers.</li>
          <li><strong>Provider profile:</strong> services, skills, service areas, availability, pricing, bio, portfolio, references, work examples, vehicle or equipment details, and status.</li>
          <li><strong>Licence, certification, and application data:</strong> licences, certifications, insurance details, application answers, review notes, profile evidence, and attachments where supplied.</li>
          <li><strong>Verification data:</strong> identity verification status, vendor session references, workflow id, verification results, liveness check outcomes, document and selfie match scores, risk flags, expiry dates, and admin review outcomes where identity verification is enabled. Where the platform performs biometric checks (liveness, facial match) the lawful basis is your explicit consent recorded inside the verification flow, supported by our legitimate interest in preventing fraud and complying with applicable trust and safety obligations under POPIA section 11 and the special-information conditions in section 26.</li>
          <li><strong>Job and lead history:</strong> lead previews, interest, shortlist events, customer selections, acceptances, declines, expiry, job status updates, photos, notes, quotes, extras, completion records, and reviews.</li>
          <li><strong>Provider credits and wallet history:</strong> paid credit balance, promotional credit balance, top-ups, vouchers, lead unlock deductions, refunds, reversals, payment intent references, audit logs, and admin adjustments.</li>
          <li><strong>Settlement data:</strong> payout, fee, refund, chargeback, and settlement records where Plug A Pro facilitates customer payment or provider settlement.</li>
        </ul>

        <h2>4. Automatically collected information</h2>
        <ul>
          <li>Device, browser, operating system, and approximate network information.</li>
          <li>Session cookies, authentication tokens, local storage data, and security logs needed to operate the PWA.</li>
          <li>API request logs, audit logs, error logs, trace IDs, and fraud or abuse signals.</li>
          <li>Marketing-site analytics, including Google Analytics events and page interaction data where analytics is enabled.</li>
        </ul>

        <h2>5. Why we use personal information</h2>
        <ul>
          <li><strong>Platform operation:</strong> intake, matching, lead routing, quote flow, booking communication, status updates, job records, WhatsApp and PWA handoff, support, and dispute handling.</li>
          <li><strong>Provider operations:</strong> onboarding, application review, identity checks where enabled, wallet and credit records, top-ups, deductions, reversals, and lead eligibility controls.</li>
          <li><strong>Payments and accounting:</strong> payment references, receipts, refunds, chargebacks, settlement, reconciliation, tax and accounting records, fraud review, and audit logs.</li>
          <li><strong>Safety and trust:</strong> staged contact sharing, job evidence, abuse prevention, account suspension, support review, and lawful dispute cooperation.</li>
          <li><strong>Legal compliance:</strong> POPIA, tax, accounting, consumer, electronic transaction, law enforcement, and court or regulator requests.</li>
          <li><strong>Marketing:</strong> sending marketing only where consent or another lawful basis applies, and recording opt-in or opt-out choices.</li>
        </ul>
        <p>We do <strong>not</strong> sell personal information.</p>

        <h2>6. How information is shared</h2>
        <ul>
          <li><strong>Customers and providers:</strong> information is shared as needed for the request, quote, booking, service performance, support, and dispute process. Exact address and phone details are shared only after the customer selects a provider and that provider accepts the job, unless another lawful workflow is expressly shown.</li>
          <li><strong>Meta / WhatsApp:</strong> WhatsApp messages and message metadata are processed through Meta&apos;s WhatsApp Business services.</li>
          <li><strong>Supabase:</strong> database, authentication, storage, and operational data infrastructure where used.</li>
          <li><strong>Vercel and Vercel Blob:</strong> hosting, application delivery, logs, and file/object storage where used.</li>
          <li><strong>Payment providers:</strong> PayFast, Pay@ / PayAt, PayAt Go, and any payment processor or payment reference provider shown in the payment flow, where used.</li>
          <li><strong>Identity verification providers:</strong> Didit (https://didit.me), Smile ID, and any other identity verification vendor named on the consent screen at the time you complete the verification flow. These vendors receive identity document data, selfie images, and liveness frames for the purpose of verifying your identity. Vendor processing happens under our written instructions and POPIA section 21 operator obligations.</li>
          <li><strong>Google services:</strong> Google Analytics on the marketing site.</li>
          <li><strong>Location and map services:</strong> static location data, OpenStreetMap / Nominatim geocoding, and any external map link you choose to open from the platform, where used.</li>
          <li><strong>Sentry or logging providers:</strong> error, performance, and diagnostic logs where enabled.</li>
          <li><strong>Regulators, courts, and law enforcement:</strong> where required or permitted by South African law.</li>
        </ul>

        <h2>7. POPIA rights</h2>
        <p>Subject to lawful limits and retention duties, you may request:</p>
        <ul>
          <li>access to personal information we hold about you;</li>
          <li>correction of inaccurate, incomplete, or outdated information;</li>
          <li>deletion or restriction of information where legally available;</li>
          <li>objection to processing, including direct marketing;</li>
          <li>confirmation of whether we hold personal information about you;</li>
          <li>complaint handling by Plug A Pro or the Information Regulator.</li>
        </ul>
        <p>
          To exercise these rights, email{" "}
          <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a>. We may need to verify
          your identity before acting on the request.
        </p>

        <h2>8. WhatsApp, service messages, and marketing</h2>
        <p>
          Transactional WhatsApp messages are used for account access, request updates, matching,
          quotes, bookings, status updates, payment information, credit actions, support, and dispute
          handling. These messages are part of the Platform operation.
        </p>
        <p>
          Marketing messages are sent only where you have opted in or where another lawful basis
          applies. You can opt out of marketing by replying <strong>STOP</strong> to a marketing
          message or emailing <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>.
          We do not share your contact details with third parties for their own marketing.
        </p>

        <h2>9. Cookies and analytics</h2>
        <p>
          The PWA uses necessary cookies, session storage, or local storage for authentication,
          security, saved drafts, and platform functionality. The marketing site uses Google Analytics
          to understand page traffic and campaign performance. Browser or device settings may let you
          restrict some cookies or analytics, but the Platform may not function properly without
          necessary session technology.
        </p>

        <h2>10. Retention</h2>
        <ul>
          <li><strong>Active accounts:</strong> retained while the account is active.</li>
          <li><strong>Job, booking, quote, payment, credit, and audit records:</strong> retained for accounting, dispute, fraud, tax, and legal purposes, typically up to 5 years or longer where law requires.</li>
          <li><strong>WhatsApp and support records:</strong> retained while needed for Platform operation, support, fraud prevention, disputes, and lawful audit purposes.</li>
          <li><strong>Provider application and verification records:</strong> retained while the provider account is active and for a lawful period afterward for compliance, audit, dispute, and fraud purposes.</li>
          <li><strong>Marketing leads:</strong> retained until no longer needed for the purpose collected or until opt-out/deletion where legally available.</li>
        </ul>
        <p>
          Retention periods are operational policy targets and may need adjustment after attorney,
          tax, accounting, and POPIA review.
        </p>

        <h2>11. Security and breach notification</h2>
        <p>
          We use access controls, authentication, role-based permissions, transport security, audit
          logs, and operational monitoring to protect personal information. No system is completely
          secure. If we become aware of a security compromise that requires notification under POPIA,
          we will notify the Information Regulator and affected data subjects as soon as reasonably
          possible, subject to lawful investigation needs.
        </p>

        <h2>12. Cross-border processing</h2>
        <p>
          Some of the operators named in section 6 are based outside South Africa. In particular,
          Vercel, Meta / WhatsApp, Google, Sentry, and Didit are based in the <strong>United States</strong>;
          our Supabase infrastructure is hosted in the <strong>European Union</strong> (Frankfurt, Germany);
          Smile ID is based in <strong>Africa and the United States</strong>; and other named operators
          may process data in the regions disclosed at the point of use.
        </p>
        <p>
          Where cross-border processing applies, we rely on the safeguards required by POPIA section 72:
          either a law in the recipient country that provides an adequate level of protection (for
          example, EU data protection law applicable to our EU-hosted databases), contractual safeguards
          (data processing agreements and standard contractual clauses signed with each operator), or
          your consent recorded at the point of the relevant flow. You can ask us for a summary of the
          safeguards applicable to a specific processor by emailing{" "}
          <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a>.
        </p>

        <h2>13. Children</h2>
        <p>
          The Platform is for users aged 18 and older. We do not knowingly collect information from
          children. If you believe a child has supplied personal information, contact us so we can
          review and delete it where required.
        </p>

        <h2>14. Changes</h2>
        <p>
          We may update this policy to reflect product, legal, security, or operational changes.
          Material changes will be communicated through the Platform, WhatsApp, or the website where
          appropriate.
        </p>

        <h2>15. Contact</h2>
        <p>
          Privacy: <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a>
          <br />
          Support: <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>
          <br />
          Legal: <a href="mailto:legal@plugapro.co.za">legal@plugapro.co.za</a>
        </p>
        <p>
          <strong>Information Regulator (South Africa):</strong>{" "}
          <a href="https://inforegulator.org.za/" target="_blank" rel="noopener noreferrer">
            inforegulator.org.za
          </a>
        </p>
      </div>
    </div>
  );
}
