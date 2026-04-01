import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Terms of Service" });

export default function TermsPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 1 April 2026</p>

        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the Plug a Pro platform, including the website
          at <strong>plugapro.co.za</strong>, the web app at <strong>app.plugapro.co.za</strong>, and our WhatsApp
          booking channel. By using any part of the platform you agree to these Terms in full. If you do not
          agree, please stop using the platform.
        </p>

        <h2>1. Who We Are</h2>
        <p>
          Plug a Pro (&ldquo;Plug a Pro&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a South African marketplace that connects
          customers who need home services (plumbing, electrical, painting, gardening, and more) with
          independent, verified service providers (&ldquo;Providers&rdquo;). We are a marketplace, not a service
          provider. We do not employ the Providers listed on the platform.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be at least 18 years old to use the platform. By using the platform you confirm that
          you meet this requirement. Providers must hold any licences or certifications required by South
          African law for the services they offer (e.g. registered electricians under the Electrical
          Installation Regulations).
        </p>

        <h2>3. The Plug a Pro Service</h2>
        <p>Plug a Pro allows customers to:</p>
        <ul>
          <li>Submit job requests via WhatsApp or the web app</li>
          <li>Be matched with nearby verified Providers</li>
          <li>Receive quotes, confirm bookings, and make secure online payments</li>
          <li>Rate and review completed jobs</li>
        </ul>
        <p>Plug a Pro allows Providers to:</p>
        <ul>
          <li>Register and be verified on the platform</li>
          <li>Receive job leads matching their skills and service area</li>
          <li>Accept, quote, and complete jobs</li>
          <li>Receive payment via the platform</li>
        </ul>

        <h2>4. Customer Obligations</h2>
        <ul>
          <li>Provide an accurate service address and be available at the agreed time</li>
          <li>Describe the job accurately &mdash; misrepresentation may result in additional charges</li>
          <li>Treat Providers with respect</li>
          <li>Pay any agreed extras approved via the platform before work begins</li>
          <li>Not attempt to hire Providers off-platform to circumvent our service fees</li>
        </ul>

        <h2>5. Provider Obligations</h2>
        <ul>
          <li>Provide accurate information about your skills, experience, and qualifications</li>
          <li>Hold any required licences and maintain adequate public liability insurance</li>
          <li>Arrive on time and complete work to a professional standard</li>
          <li>Quote honestly and not add undisclosed costs after a job is accepted</li>
          <li>Comply with all applicable South African health, safety, and labour laws</li>
          <li>Not solicit customers off-platform for services matching those booked through Plug a Pro</li>
        </ul>

        <h2>6. Payments</h2>
        <p>
          Payments are processed securely through <strong>PayFast</strong>. By making a payment you agree to
          PayFast&rsquo;s terms of service.
        </p>
        <h3>Refund Policy</h3>
        <ul>
          <li><strong>Cancelled 24+ hours before the booking:</strong> Full refund</li>
          <li><strong>Cancelled less than 24 hours before the booking:</strong> 50% cancellation fee applies</li>
          <li><strong>No-show (customer not available):</strong> No refund</li>
          <li><strong>Provider no-show:</strong> Full refund issued within 3&ndash;5 business days</li>
          <li><strong>Disputed work quality:</strong> Contact support within 48 hours of job completion.
          We will investigate and may issue a partial or full refund at our discretion.</li>
        </ul>
        <p>
          For quote-based jobs, payment is due after you accept the quote. Work commences only after
          payment is confirmed.
        </p>

        <h2>7. Matching and Availability</h2>
        <p>
          We make reasonable efforts to match job requests with suitable Providers. We cannot guarantee
          a match in all areas or at all times. If no Provider is available, we will notify you and place
          you on a waitlist.
        </p>

        <h2>8. Ratings and Reviews</h2>
        <p>
          After a job is completed, customers may rate and review the Provider. Reviews must be honest
          and based on genuine experience. We reserve the right to remove reviews that contain false
          information, hate speech, or personal attacks.
        </p>

        <h2>9. Prohibited Conduct</h2>
        <p>You must not:</p>
        <ul>
          <li>Provide false or misleading information at any point</li>
          <li>Use the platform for any unlawful purpose</li>
          <li>Harass, threaten, or abuse other users or platform staff</li>
          <li>Attempt to reverse-engineer, scrape, or disrupt the platform</li>
          <li>Create multiple accounts to circumvent a suspension or ban</li>
        </ul>
        <p>
          Violations may result in immediate account suspension and, where applicable, referral to
          law enforcement.
        </p>

        <h2>10. Limitation of Liability</h2>
        <p>
          Plug a Pro is a marketplace. We do not perform the services ourselves and are not liable
          for the quality, safety, or outcome of work performed by Providers. Our liability to you
          in connection with any job is limited to the amount paid for that job through our platform.
        </p>
        <p>
          To the maximum extent permitted by South African law, we exclude liability for indirect,
          consequential, or special damages arising from use of the platform.
        </p>

        <h2>11. Intellectual Property</h2>
        <p>
          All content on the platform &mdash; including the Plug a Pro name, logo, and software &mdash; is the
          property of Plug a Pro and may not be used without our written permission.
        </p>

        <h2>12. Suspension and Termination</h2>
        <p>
          We may suspend or terminate your account if you breach these Terms, engage in fraudulent
          activity, or pose a risk to other users. You may delete your account at any time by
          contacting us.
        </p>

        <h2>13. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. We will notify you of material changes via
          WhatsApp or a notice on the platform at least 14 days before they take effect. Continued
          use of the platform after changes take effect constitutes acceptance.
        </p>

        <h2>14. Dispute Resolution</h2>
        <p>
          If you have a dispute, please contact our support team first at{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a> — we aim to resolve
          all issues within 5 business days.
        </p>
        <p>
          For complaints about how we handle personal information, you may also approach the
          Information Regulator of South Africa at{" "}
          <a href="https://www.justice.gov.za/inforeg/" target="_blank" rel="noopener noreferrer">
            justice.gov.za/inforeg
          </a>.
        </p>

        <h2>15. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the Republic of South Africa. Any disputes that
          cannot be resolved amicably will be subject to the jurisdiction of the South African courts.
        </p>

        <h2>16. Contact</h2>
        <p>
          Email: <a href="mailto:legal@plugapro.co.za">legal@plugapro.co.za</a><br />
          Support: <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a><br />
          Plug a Pro &mdash; Registered in South Africa
        </p>
      </div>
    </div>
  );
}
