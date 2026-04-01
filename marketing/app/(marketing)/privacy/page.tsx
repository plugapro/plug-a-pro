import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Privacy Policy", noIndex: false });

export default function PrivacyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 1 April 2026</p>

        <p>
          Plug a Pro (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) operates the marketplace platform at{" "}
          <strong>plugapro.co.za</strong> and <strong>app.plugapro.co.za</strong>, including our WhatsApp booking
          channel. This Privacy Policy explains how we collect, use, store, and protect your personal information
          in compliance with the Protection of Personal Information Act 4 of 2013 (&ldquo;POPIA&rdquo;).
        </p>

        <h2>1. Information We Collect</h2>
        <h3>From Customers</h3>
        <ul>
          <li><strong>Identity:</strong> First name (collected during WhatsApp onboarding)</li>
          <li><strong>Contact:</strong> WhatsApp phone number (used as your account identifier)</li>
          <li><strong>Location:</strong> Service address (street, suburb, city) provided when booking</li>
          <li><strong>Job details:</strong> Service category, availability preferences, and job descriptions</li>
          <li><strong>Payment:</strong> Payment confirmation data from PayFast — we do not store card numbers</li>
          <li><strong>Conversation history:</strong> WhatsApp messages exchanged with our bot to process your requests</li>
        </ul>

        <h3>From Service Providers</h3>
        <ul>
          <li><strong>Identity:</strong> Full name and ID verification status</li>
          <li><strong>Contact:</strong> WhatsApp phone number</li>
          <li><strong>Professional:</strong> Skills, service areas, experience, and availability</li>
          <li><strong>Earnings:</strong> Job completion records and payment disbursement history</li>
        </ul>

        <h3>Automatically Collected</h3>
        <ul>
          <li>Device type and browser (web app users only)</li>
          <li>Session tokens to keep you signed in</li>
          <li>API request logs for security and debugging</li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <ul>
          <li><strong>Service delivery:</strong> Matching customers with suitable nearby providers</li>
          <li><strong>Communications:</strong> Booking confirmations, job updates, and support via WhatsApp</li>
          <li><strong>Payments:</strong> Processing and reconciling payments through PayFast</li>
          <li><strong>Safety:</strong> Verifying provider identity, detecting fraud, and preventing abuse</li>
          <li><strong>Improvement:</strong> Analysing anonymised usage patterns to improve the platform</li>
          <li><strong>Legal compliance:</strong> Meeting obligations under POPIA and South African law</li>
        </ul>
        <p>We do <strong>not</strong> sell your personal information to third parties.</p>

        <h2>3. How We Share Your Information</h2>
        <ul>
          <li><strong>Matched providers:</strong> Receive your first name, suburb, and job description only. Your phone number is not shared directly &mdash; all communication flows through our platform.</li>
          <li><strong>PayFast:</strong> Payment processing. Their privacy policy governs data they collect at checkout.</li>
          <li><strong>Supabase:</strong> Database and authentication infrastructure, hosted in a GDPR-compliant data centre.</li>
          <li><strong>Meta (WhatsApp):</strong> Messages via our WhatsApp channel are processed by Meta Platforms under their terms.</li>
          <li><strong>Vercel:</strong> Our hosting provider for application code and infrastructure.</li>
          <li><strong>Law enforcement:</strong> Where required by a valid court order or applicable South African law.</li>
        </ul>

        <h2>4. Your Rights Under POPIA</h2>
        <p>As a data subject under POPIA, you have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of the personal information we hold about you</li>
          <li><strong>Correction:</strong> Ask us to correct inaccurate or incomplete information</li>
          <li><strong>Deletion:</strong> Request deletion of your account and data (subject to legal retention obligations)</li>
          <li><strong>Objection:</strong> Object to processing for direct marketing purposes</li>
          <li><strong>Complaints:</strong> Lodge a complaint with the Information Regulator at <a href="https://www.justice.gov.za/inforeg/" target="_blank" rel="noopener noreferrer">justice.gov.za/inforeg</a></li>
        </ul>
        <p>
          To exercise any of these rights, email <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a>.
          We will respond within 30 days.
        </p>

        <h2>5. Data Retention</h2>
        <ul>
          <li><strong>Active accounts:</strong> Retained while your account is active</li>
          <li><strong>Deleted accounts:</strong> Personal data deleted within 30 days of closure, except where required for tax or legal purposes (up to 5 years)</li>
          <li><strong>Job records:</strong> Retained for 5 years for financial and audit purposes</li>
          <li><strong>WhatsApp conversations:</strong> Retained for 12 months, then anonymised</li>
        </ul>

        <h2>6. Security</h2>
        <p>We implement industry-standard security measures including TLS encryption in transit, encrypted storage at rest, and role-based access controls. If you discover a security vulnerability, report it to <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a>.</p>

        <h2>7. Cookies</h2>
        <p>Our web app uses session cookies only (strictly necessary for authentication). We do not use tracking or advertising cookies. The marketing site uses no cookies.</p>

        <h2>8. Children</h2>
        <p>Our platform is for users aged 18 and over. We do not knowingly collect personal information from minors. Contact us to request deletion if a minor has provided their details.</p>

        <h2>9. Changes to This Policy</h2>
        <p>We may update this policy from time to time. Material changes will be communicated via WhatsApp or a notice on the platform. The &ldquo;Last updated&rdquo; date reflects the most recent revision.</p>

        <h2>10. Contact</h2>
        <p>
          Email: <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a><br />
          Plug a Pro &mdash; Registered in South Africa
        </p>
      </div>
    </div>
  );
}
