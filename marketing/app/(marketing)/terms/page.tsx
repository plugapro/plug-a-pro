import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Terms of Service" });

export default function TermsPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 29 April 2026</p>

        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the Plug A Pro platform, including
          the website at <strong>plugapro.co.za</strong>, the web app at <strong>app.plugapro.co.za</strong>,
          and our WhatsApp booking channel (&ldquo;the Platform&rdquo;). By registering, booking a service,
          or using any part of the Platform, you agree to these Terms in full. If you do not agree, do not
          use the Platform.
        </p>

        <p>
          <em>
            These Terms are intended to be read alongside our{" "}
            <a href="/privacy">Privacy Policy</a>,{" "}
            <a href="/credits-policy">Provider Credits Terms and Rules</a>,{" "}
            <a href="/refund-policy">Refund and Cancellation Policy</a>, and, for service providers,
            our <a href="/provider-terms">Service Provider Terms</a>.
          </em>
        </p>

        <h2>1. Definitions</h2>
        <ul>
          <li><strong>&ldquo;Platform&rdquo;</strong> means the Plug A Pro website, web app, and WhatsApp booking channel collectively.</li>
          <li><strong>&ldquo;Plug A Pro&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;</strong> means the company operating the Platform, registered in South Africa.</li>
          <li><strong>&ldquo;Customer&rdquo;</strong> means a person who uses the Platform to request or book a service.</li>
          <li><strong>&ldquo;Provider&rdquo; or &ldquo;Service Provider&rdquo;</strong> means an independent person or business that uses the Platform to find and complete service jobs.</li>
          <li><strong>&ldquo;Booking&rdquo;</strong> means a confirmed service appointment between a Customer and a Provider, facilitated through the Platform.</li>
          <li><strong>&ldquo;Credits&rdquo;</strong> means platform-issued accounting units that can be applied toward eligible fees or services on the Platform. Credits are not legal tender, not interest-bearing, and cannot be withdrawn as cash unless Plug A Pro expressly agrees or law requires it. See our <a href="/credits-policy">Provider Credits Terms and Rules</a> for full details.</li>
          <li><strong>&ldquo;Quote&rdquo;</strong> means a written estimate provided by a Provider through the Platform for a specific job.</li>
        </ul>

        <h2>2. Who We Are — Platform Operator, Not Service Provider</h2>
        <p>
          Plug A Pro is a <strong>technology marketplace and booking facilitation platform</strong>. We connect
          Customers with independent Providers. We are <strong>not</strong> the supplier of any field service.
          We do not employ Providers. Providers are independent contractors who supply services directly to
          Customers under the terms of the relevant Quote and Booking.
        </p>
        <p>
          When you book a service through Plug A Pro, the contract for the actual performance of that service
          is between you and the Provider. Plug A Pro&apos;s role is to facilitate the booking, facilitate
          payment where applicable, maintain the job record, and provide support — not to perform the service
          itself.
        </p>
        <p>
          Plug A Pro does not guarantee the identity, qualifications, licensing, legality, safety, or quality
          of any Provider&apos;s work except where Plug A Pro has <strong>expressly stated in writing on
          the Platform</strong> that a specific check has been completed.
        </p>

        <h2>3. Eligibility</h2>
        <p>
          You must be at least 18 years old and legally capable of entering into contracts under South African
          law to use the Platform. By using the Platform you confirm that you meet these requirements.
        </p>
        <p>
          Providers must hold any licences, registrations, permits, or certifications required by South
          African law for the specific services they offer (for example: plumbers under applicable plumbing
          codes, or any other trade where South African law requires a licence or registration).
        </p>

        <h2>4. How the Platform Works</h2>
        <ol>
          <li>A Customer submits a job request via WhatsApp or the web app, describing the service needed and providing a service address.</li>
          <li>Plug A Pro matches the request with one or more suitable nearby Providers based on skills, location, and availability.</li>
          <li>A Provider reviews the request and, if interested, accepts and submits a Quote.</li>
          <li>The Customer reviews and accepts the Quote through the Platform.</li>
          <li>A Booking is confirmed. Payment instructions, if applicable, are provided at this stage.</li>
          <li>The Provider performs the service. Job status updates are sent via the Platform.</li>
          <li>Completion is confirmed. Payment is processed or confirmed if applicable. An invoice or receipt is issued.</li>
        </ol>

        <h2>5. Customer Obligations</h2>
        <ul>
          <li>Provide accurate service address and contact details and be available at the agreed time.</li>
          <li>Describe the job accurately. Misrepresentation may result in additional charges or cancellation at the Provider&apos;s discretion.</li>
          <li>Approve any extra work or extra charges in writing through the Platform before the Provider proceeds. Do not agree to off-platform verbal extras.</li>
          <li>Ensure the site is accessible, reasonably safe, and suitable for the service to be performed.</li>
          <li>Treat Providers with dignity and respect. Abuse, threats, or harassment will result in account suspension.</li>
          <li>Pay any agreed amounts at the times specified in the Quote and Booking confirmation.</li>
          <li>Do not attempt to hire Providers outside the Platform to circumvent Platform fees for services that were introduced through the Platform.</li>
        </ul>

        <h2>6. Provider Obligations</h2>
        <p>Providers are bound by the <a href="/provider-terms">Service Provider Terms</a>, which are a condition of using the Platform. Key obligations include:</p>
        <ul>
          <li>Maintain accurate profiles, pricing, and availability information.</li>
          <li>Hold all licences, registrations, permits, and insurance required by law.</li>
          <li>Perform services with reasonable care, skill, professionalism, and in compliance with applicable safety and trade laws.</li>
          <li>Arrive on time. Notify Plug A Pro and the Customer promptly if unable to attend.</li>
          <li>Obtain Customer approval via the Platform before any work outside the original Quote scope.</li>
          <li>Not solicit Customers to bypass the Platform for Platform-introduced work.</li>
          <li>Cooperate with Plug A Pro&apos;s dispute and complaints process.</li>
        </ul>

        <h2>7. Quotes, Pricing, and Extra Work</h2>
        <p>
          All Quotes are provided by Providers and represent their estimate for the described job.
          Quotes are not guaranteed fixed prices unless expressly labelled as fixed in the Platform record.
          Call-out fees, if applicable, are disclosed in the Quote.
        </p>
        <p>
          If a Provider identifies scope changes, additional work, or unexpected conditions on-site, they
          must request approval through the Platform before proceeding. Any unapproved extras are between
          the Provider and the Customer. Plug A Pro facilitates but does not guarantee the outcome of
          unapproved scope changes.
        </p>

        <h2>8. Payments</h2>
        <p>
          Plug A Pro facilitates payment for bookings using third-party payment processors (currently Peach
          Payments and PayFast). Plug A Pro does not store card numbers. Payment processor availability is
          subject to the processor&apos;s own terms, outages, and fraud rules.
        </p>
        <p>
          Credits may be applied at checkout where available. See our <a href="/credits-policy">Credits and
          Wallet Policy</a> for the full rules governing Credits, top-ups, expiry, and refunds involving Credits.
        </p>
        <p>
          If Plug A Pro facilitated payment and the service is not performed or is materially defective,
          you may be entitled to a refund in accordance with our <a href="/refund-policy">Refund and
          Cancellation Policy</a> and applicable South African consumer law.
        </p>
        <p>
          If you paid a Provider directly (outside Platform-facilitated payment), Plug A Pro can review
          the dispute record but cannot process a direct refund for a payment it did not handle.
        </p>

        <h2>9. Cancellations and Refunds</h2>
        <p>
          Cancellation and refund rights depend on who cancels, when, and whether service has commenced.
          See our <a href="/refund-policy">Refund and Cancellation Policy</a> for the full matrix covering
          all scenarios, including Platform-facilitated payment refunds, credit reversals, Provider cancellations,
          Customer no-shows, and partial completions.
        </p>
        <p>
          Your statutory rights under the Consumer Protection Act 68 of 2008 (&ldquo;CPA&rdquo;) are not
          excluded or limited by our policies. If there is a conflict, your statutory rights prevail.
        </p>

        <h2>10. Matching and Availability</h2>
        <p>
          Plug A Pro makes reasonable efforts to match job requests with suitable Providers. We cannot
          guarantee availability in all areas or at all times. If no match is available, we will
          notify you and may offer a waitlist or alternative options where possible.
        </p>

        <h2>11. Credits and Wallet</h2>
        <p>
          Credits are a Platform accounting mechanism. They are not cash, bank deposits, or legal tender.
          The full rules for Credits — including types, expiry, top-up, use at checkout, refund behaviour,
          and what happens on cancellation or dispute — are set out in our{" "}
          <a href="/credits-policy">Provider Credits Terms and Rules</a>. That policy is incorporated into these
          Terms by reference.
        </p>

        <h2>12. WhatsApp, SMS, and Communication</h2>
        <p>
          By using the Platform, you consent to receiving transactional WhatsApp messages about your
          bookings, job updates, payment confirmations, and Platform activity (&ldquo;service messages&rdquo;).
          These are necessary for the Platform to function and cannot be turned off without stopping use of
          the Platform.
        </p>
        <p>
          Marketing messages (promotions, offers, reminders not directly tied to an active booking) are
          sent only where you have opted in. You may opt out of marketing messages at any time by replying
          <strong>STOP</strong> to any marketing WhatsApp message or by contacting{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>.
        </p>
        <p>
          Plug A Pro uses the Meta WhatsApp Business API. WhatsApp message delivery is subject to Meta&apos;s
          platform availability and your device/network conditions. Important Booking and payment information
          is also available inside the Platform web app at app.plugapro.co.za.
        </p>

        <h2>13. Ratings and Reviews</h2>
        <p>
          After a job is completed, Customers may rate and review the Provider. Reviews must be honest and
          based on genuine experience. Reviews that contain false information, hate speech, or personal
          attacks will be removed. Providers may report reviews for investigation. Plug A Pro&apos;s
          decision on reviews is final.
        </p>

        <h2>14. User Content</h2>
        <p>
          You may submit content to the Platform including job descriptions, photos, and reviews. You grant
          Plug A Pro a non-exclusive, royalty-free licence to use that content for Platform operation, safety,
          and improvement purposes. Job photos submitted by Providers are used to evidence job completion
          and support dispute resolution. They are retained for the period stated in our Privacy Policy and
          are not sold to third parties.
        </p>

        <h2>15. Prohibited Conduct</h2>
        <p>You must not:</p>
        <ul>
          <li>Provide false or misleading information at any point on the Platform.</li>
          <li>Use the Platform for any unlawful purpose or to facilitate illegal activity.</li>
          <li>Harass, threaten, or abuse other users, Providers, or Plug A Pro staff.</li>
          <li>Attempt to reverse-engineer, scrape, automate, or disrupt the Platform.</li>
          <li>Create duplicate accounts to circumvent a suspension or ban.</li>
          <li>Abuse the refund, credit, or dispute process (including fraudulent chargebacks or fabricated complaints).</li>
          <li>Solicit Providers or Customers to transact outside the Platform for Platform-introduced services.</li>
          <li>Use credits in a manner inconsistent with the Provider Credits Rules.</li>
        </ul>
        <p>Violations may result in account suspension, credit forfeiture, and/or referral to law enforcement.</p>

        <h2>16. Platform Availability and Technical Limitations</h2>
        <p>
          The Platform is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We aim for high
          availability but do not guarantee uninterrupted access. Maintenance, updates, or third-party
          infrastructure outages (Supabase, Vercel, Meta WhatsApp, payment processors) may cause temporary
          unavailability. We are not liable for losses caused by Platform downtime except where required
          by South African law.
        </p>

        <h2>17. Third-Party Services</h2>
        <p>
          Plug A Pro uses third-party services including Meta (WhatsApp), Supabase (database/authentication),
          Vercel (hosting), and payment processors. Your use of those services is also subject to their
          terms. Plug A Pro is not liable for third-party service failures, outages, or data handling beyond
          the scope of our contractual arrangements with those parties and the requirements of South African law.
        </p>

        <h2>18. Disputes Between Customers and Providers</h2>
        <p>
          Because the service contract is between the Customer and the Provider, disputes about service
          quality, workmanship, damage, or non-performance are primarily between those parties.
        </p>
        <p>
          Plug A Pro provides a support and escalation service. We will review the Platform record, job
          photos, communication history, and any other available evidence. Where we facilitated payment,
          we may take steps to facilitate a resolution, including refunds or credits, in accordance with
          our Refund and Cancellation Policy. We do not act as arbiters and our decisions are operational
          determinations, not legal judgments.
        </p>
        <p>
          Your rights under the Consumer Protection Act are not affected by this clause.
        </p>

        <h2>19. Limitation of Liability</h2>
        <p>
          Plug A Pro is a marketplace facilitator. We are not the supplier of field services and are not
          liable for the quality, safety, outcome, or legality of work performed by Providers. Our
          maximum aggregate liability to you in connection with any specific job is limited to the amount
          we actually received and processed as payment for that job, except where law requires otherwise.
        </p>
        <p>
          We exclude liability for indirect, consequential, special, or punitive damages to the maximum
          extent permitted by South African law. We do <strong>not</strong> exclude or limit liability for:
        </p>
        <ul>
          <li>death or personal injury caused by our own negligence;</li>
          <li>fraud or fraudulent misrepresentation by us;</li>
          <li>rights that cannot lawfully be excluded under the Consumer Protection Act or POPIA.</li>
        </ul>

        <h2>20. Indemnities</h2>
        <p>
          Customers indemnify Plug A Pro against claims, losses, and costs arising from: the Customer&apos;s
          breach of these Terms; false information provided by the Customer; Customer conduct toward
          Providers; and any unsafe, unlawful, or abusive site conditions the Customer creates or permits.
        </p>
        <p>
          Providers indemnify Plug A Pro against claims, losses, and costs arising from: the Provider&apos;s
          negligence, poor workmanship, or breach of law; damage to Customer property; Provider fraud;
          non-compliance with licensing or safety requirements; and any claim by a Customer arising from
          the Provider&apos;s services. See the <a href="/provider-terms">Service Provider Terms</a> for
          the full provider indemnity clause.
        </p>

        <h2>21. Consumer Rights Preservation</h2>
        <p>
          Nothing in these Terms removes or limits rights that cannot lawfully be excluded under South
          African law, including rights under:
        </p>
        <ul>
          <li>The Consumer Protection Act 68 of 2008 (CPA)</li>
          <li>The Protection of Personal Information Act 4 of 2013 (POPIA)</li>
          <li>The Electronic Communications and Transactions Act 25 of 2002 (ECTA)</li>
          <li>Any other applicable mandatory South African consumer protection legislation</li>
        </ul>
        <p>
          If any clause in these Terms is found to be unenforceable, the remaining clauses continue in full
          force.
        </p>

        <h2>22. Suspension and Termination</h2>
        <p>
          We may suspend or terminate your account if you breach these Terms, engage in fraudulent activity,
          abuse the credits or refund systems, or pose a risk to other users. We will give you advance
          notice where reasonably practical, except where we must act immediately to protect the Platform
          or other users.
        </p>
        <p>
          You may close your account at any time by contacting{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>. Closure is subject to our
          data retention obligations under POPIA and our <a href="/privacy">Privacy Policy</a>. Outstanding
          credits, disputes, or payment obligations will be resolved before or at account closure.
        </p>

        <h2>23. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time to reflect legal, regulatory, or product changes.
          Material changes will be communicated via WhatsApp or a prominent notice on the Platform at
          least 14 days before they take effect. Your continued use of the Platform after the effective
          date constitutes acceptance of the updated Terms.
        </p>
        <p>
          If you do not accept an update, you may close your account before the effective date. We will
          retain a dated history of Terms versions.
        </p>

        <h2>24. Intellectual Property</h2>
        <p>
          All Platform content — including the Plug A Pro name, logo, software, and interface design — is
          proprietary to Plug A Pro and may not be copied, reproduced, or used without written permission,
          except as permitted by law.
        </p>

        <h2>25. Dispute Resolution</h2>
        <p>
          Contact our support team first at{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>. We aim to respond within
          2 business days and resolve issues within 5 business days.
        </p>
        <p>
          For complaints about how we handle personal information, contact the Information Regulator of
          South Africa at{" "}
          <a href="https://www.justice.gov.za/inforeg/" target="_blank" rel="noopener noreferrer">
            justice.gov.za/inforeg
          </a>.
        </p>
        <p>
          If a dispute cannot be resolved amicably, it will be subject to the jurisdiction of the South
          African courts.
        </p>

        <h2>26. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the Republic of South Africa. The Consumer Protection
          Act, POPIA, ECTA, and other mandatory South African legislation apply where relevant.
        </p>

        <h2>27. Contact</h2>
        <p>
          Legal: <a href="mailto:legal@plugapro.co.za">legal@plugapro.co.za</a><br />
          Support: <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a><br />
          Privacy: <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a><br />
          Plug A Pro — Registered in South Africa
        </p>
      </div>
    </div>
  );
}
