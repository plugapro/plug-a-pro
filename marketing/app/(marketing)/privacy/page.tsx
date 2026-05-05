import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Privacy Policy", noIndex: false });

export default function PrivacyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 29 April 2026</p>

        <p>
          Plug A Pro (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) operates the marketplace
          platform at <strong>plugapro.co.za</strong> and <strong>app.plugapro.co.za</strong>, including
          our WhatsApp booking channel. This Privacy Policy explains how we collect, use, store, protect,
          and share your personal information in compliance with the{" "}
          <strong>Protection of Personal Information Act 4 of 2013 (&ldquo;POPIA&rdquo;)</strong> and
          other applicable South African law.
        </p>

        <p>
          <em>This policy is intended to be read alongside our <a href="/terms">Terms of Service</a>.</em>
        </p>

        <h2>1. Who is Responsible for Your Information</h2>
        <p>
          Plug A Pro is the &ldquo;responsible party&rdquo; under POPIA for personal information
          collected through the Platform. Our privacy contact is:{" "}
          <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a>.
        </p>

        <h2>2. What Personal Information We Collect</h2>

        <h3>From Customers</h3>
        <ul>
          <li><strong>Identity:</strong> First name (collected during WhatsApp onboarding or registration)</li>
          <li><strong>Contact:</strong> WhatsApp phone number (used as your account identifier)</li>
          <li><strong>Location:</strong> Service address (street, suburb, city) provided when booking</li>
          <li><strong>Job details:</strong> Service category, availability preferences, job descriptions, and any special instructions</li>
          <li><strong>Payment:</strong> When Platform-facilitated payment is used — transaction confirmation, reference numbers, and reconciliation data from the payment processor. We do not store card numbers.</li>
          <li><strong>Conversation history:</strong> WhatsApp messages exchanged with our Platform to process your requests, including message status (sent, delivered, read)</li>
          <li><strong>Reviews and ratings</strong> you submit for Providers</li>
        </ul>

        <h3>From Service Providers</h3>
        <ul>
          <li><strong>Identity:</strong> Full name, identity number (handled with heightened protection under POPIA — not logged or exported without lawful basis)</li>
          <li><strong>Contact:</strong> WhatsApp phone number, email address where provided</li>
          <li><strong>Professional:</strong> Skills, trade licences, service areas, experience, availability, certifications, and portfolio materials</li>
          <li><strong>Earnings and job history:</strong> Job completion records, payout history, and settlement data processed through the Platform</li>
          <li><strong>Wallet and credits:</strong> Provider credits balance, top-up history, lead unlock records</li>
          <li><strong>KYC/onboarding:</strong> Identity verification status, application review notes (internal only)</li>
        </ul>

        <h3>Automatically Collected</h3>
        <ul>
          <li>Device type and browser (web app users only, for functionality and security)</li>
          <li>Session tokens to keep you signed in</li>
          <li>API request logs for security monitoring and debugging</li>
        </ul>

        <h2>3. Why We Process Your Information (Legal Basis)</h2>
        <ul>
          <li><strong>Contract performance:</strong> Matching Customers with Providers, processing Bookings, facilitating payment, generating invoices, managing disputes</li>
          <li><strong>Legitimate interest:</strong> Fraud prevention, abuse detection, Platform security, improving service quality</li>
          <li><strong>Legal obligation:</strong> Tax, financial record-keeping, regulatory compliance, responding to valid law enforcement requests</li>
          <li><strong>Consent:</strong> Sending marketing communications (separate consent required and revocable)</li>
        </ul>
        <p>We do <strong>not</strong> sell your personal information to third parties.</p>

        <h2>4. How We Share Your Information</h2>
        <ul>
          <li><strong>Matched Providers:</strong> Receive your first name, suburb, and job description when a lead is matched. Your full contact number is shared only once a booking is confirmed and the Provider needs to make contact.</li>
          <li><strong>Payment processors:</strong> If a Booking uses Platform-facilitated payment, your payment is processed by Peach Payments, PayFast, or another processor under their own privacy terms. We share only the minimum data required for payment processing.</li>
          <li><strong>Supabase:</strong> Our database and authentication infrastructure, hosted in a GDPR-compliant data centre. Subject to a data processing agreement.</li>
          <li><strong>Meta (WhatsApp):</strong> Messages sent via our WhatsApp channel are processed by Meta Platforms Inc. under their Business Messaging terms. We do not control Meta&apos;s data handling beyond our contractual arrangements.</li>
          <li><strong>Vercel:</strong> Our application hosting provider. Application code and logs are processed on Vercel infrastructure.</li>
          <li><strong>Law enforcement:</strong> Where required by a valid court order, subpoena, or applicable South African law.</li>
        </ul>

        <h2>5. Your Rights Under POPIA</h2>
        <p>As a data subject under POPIA, you have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of the personal information we hold about you</li>
          <li><strong>Correction:</strong> Ask us to correct inaccurate or incomplete information</li>
          <li><strong>Deletion:</strong> Request deletion of your account and personal data (subject to legal retention obligations below)</li>
          <li><strong>Objection:</strong> Object to processing for direct marketing purposes at any time</li>
          <li><strong>Restriction:</strong> Ask us to restrict how we process your data in certain circumstances</li>
          <li><strong>Complaints:</strong> Lodge a complaint with the Information Regulator of South Africa at{" "}
            <a href="https://www.justice.gov.za/inforeg/" target="_blank" rel="noopener noreferrer">
              justice.gov.za/inforeg
            </a>
          </li>
        </ul>
        <p>
          To exercise any of these rights, email{" "}
          <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a>. We will acknowledge your
          request within 5 business days and respond substantively within 30 days, as required by POPIA.
        </p>

        <h2>6. Direct Marketing and Communications Opt-Out</h2>
        <p>
          We send two categories of WhatsApp messages:
        </p>
        <ul>
          <li>
            <strong>Transactional / service messages:</strong> Booking confirmations, job updates, payment
            confirmations, support responses. These are necessary for the Platform to operate. Opting out
            means you will not receive operational updates about your bookings.
          </li>
          <li>
            <strong>Marketing messages:</strong> Promotions, referral offers, seasonal reminders, service
            suggestions. These require separate consent and you may opt out at any time by replying{" "}
            <strong>STOP</strong> to any marketing message, or by emailing{" "}
            <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>. Opt-outs are processed
            within 5 business days and are recorded in our audit log.
          </li>
        </ul>
        <p>
          We do not send unsolicited marketing without your consent. We do not pass your contact details
          to third parties for marketing purposes.
        </p>

        <h2>7. Data Retention</h2>
        <ul>
          <li><strong>Active accounts:</strong> Retained while your account is active and for 30 days after you request closure</li>
          <li><strong>Deleted accounts:</strong> Personal data deleted within 30 days of closure, except where required by law (see below)</li>
          <li><strong>Financial and tax records:</strong> Retained for 5 years from the transaction date, as required under South African tax law</li>
          <li><strong>Job and booking records:</strong> Retained for 5 years for financial, safety, audit, and legal purposes</li>
          <li><strong>WhatsApp conversations:</strong> Retained for 12 months from the date of the conversation, then anonymised</li>
          <li><strong>Audit logs:</strong> Retained for 5 years to support fraud investigation, dispute resolution, and regulatory compliance</li>
          <li><strong>Provider identity documents (ID numbers):</strong> Retained for the period required under applicable law; not included in standard data exports</li>
        </ul>

        <h2>8. Security</h2>
        <p>
          We implement industry-standard security measures including: TLS encryption for all data in transit;
          encrypted storage at rest; role-based access controls; session management; and audit logging of
          sensitive administrative actions. We conduct periodic security reviews.
        </p>
        <p>
          No system is completely secure. If you discover a security vulnerability, report it to{" "}
          <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a> and we will respond as quickly
          as possible.
        </p>

        <h2>9. Data Breach Notification</h2>
        <p>
          If we become aware of a data breach that creates a real risk of harm to data subjects, we will:
        </p>
        <ul>
          <li>Notify the Information Regulator as required under POPIA</li>
          <li>Notify affected users as soon as reasonably practicable</li>
          <li>Describe the nature of the breach, what information was affected, what steps we have taken, and what you should do</li>
        </ul>
        <p>
          Breaches are reported to the Regulator within a reasonable time of discovery in accordance with
          POPIA requirements.
        </p>

        <h2>10. Cookies</h2>
        <p>
          Our web app uses session cookies only (strictly necessary for authentication and session management).
          We do not use tracking, advertising, or analytics cookies. The marketing site (plugapro.co.za)
          uses no cookies.
        </p>

        <h2>11. Cross-Border Data Transfers</h2>
        <p>
          Some of our third-party service providers (including Supabase and Vercel) may process data in
          data centres outside South Africa. Where we use such providers, we ensure appropriate data
          processing agreements are in place that meet or exceed POPIA requirements for third-party data
          processors.
        </p>

        <h2>12. Children</h2>
        <p>
          Our Platform is for users aged 18 and over. We do not knowingly collect personal information from
          minors. If you believe a minor has provided their details, contact us at{" "}
          <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a> and we will delete the
          information promptly.
        </p>

        <h2>13. Changes to This Policy</h2>
        <p>
          We may update this policy from time to time. Material changes will be communicated via WhatsApp
          or a prominent notice on the Platform before they take effect. The &ldquo;Last updated&rdquo;
          date reflects the most recent revision. We retain dated copies of previous policy versions.
        </p>

        <h2>14. Contact</h2>
        <p>
          Privacy and data requests: <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a><br />
          General support: <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a><br />
          Plug A Pro — Registered in South Africa
        </p>
        <p>
          <strong>Information Regulator (South Africa):</strong>{" "}
          <a href="https://www.justice.gov.za/inforeg/" target="_blank" rel="noopener noreferrer">
            justice.gov.za/inforeg
          </a>
        </p>
      </div>
    </div>
  );
}
