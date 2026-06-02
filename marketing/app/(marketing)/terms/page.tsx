import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({
  title: "Terms of Service",
  description:
    "Terms for customers and independent service providers using the Plug A Pro marketplace platform, including refund and cancellation rules and the Service Provider Terms.",
});

export default function TermsPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 29 May 2026</p>

        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the Plug A Pro platform, including
          the website at <strong>plugapro.co.za</strong>, the web app at <strong>app.plugapro.co.za</strong>
          and our WhatsApp booking channel (&ldquo;the Platform&rdquo;). By registering, booking a service
          or using any part of the Platform, you agree to these Terms in full. If you do not agree, do not
          use the Platform.
        </p>

        <p>
          <em>
            These Terms are intended to be read alongside our{" "}
            <a href="/privacy">Privacy Policy</a> and our{" "}
            <a href="/credits-policy">Provider Credits Terms and Rules</a>. The Refund and Cancellation
            rules and the Service Provider Terms are part of this document - see{" "}
            <a href="#refunds">§ 27 Refunds and Cancellations</a> and{" "}
            <a href="#provider-terms">§ 28 Service Provider Terms</a>.
          </em>
        </p>

        <h2>1. Definitions</h2>
        <ul>
          <li><strong>&ldquo;Platform&rdquo;</strong> means the Plug A Pro website, web app and WhatsApp booking channel collectively.</li>
          <li><strong>&ldquo;Plug A Pro&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;</strong> means the company operating the Platform, registered in South Africa.</li>
          <li><strong>&ldquo;Customer&rdquo;</strong> means a person who uses the Platform to request or book a service.</li>
          <li><strong>&ldquo;Provider&rdquo; or &ldquo;Service Provider&rdquo;</strong> means an independent person or business that uses the Platform to find and complete service jobs.</li>
          <li><strong>&ldquo;Booking&rdquo;</strong> means a confirmed service appointment between a Customer and a Provider, facilitated through the Platform.</li>
          <li><strong>&ldquo;Provider Credits&rdquo;</strong> means prepaid provider-side platform units used by approved Providers to accept eligible customer-selected opportunities. Provider Credits are not customer credits, not payment for the Provider&apos;s actual work, not legal tender, not interest-bearing and cannot be withdrawn as cash unless Plug A Pro expressly approves a lawful reversal. See our <a href="/credits-policy">Provider Credits Terms and Rules</a> for full details.</li>
          <li><strong>&ldquo;Quote&rdquo;</strong> means a written estimate provided by a Provider through the Platform for a specific job.</li>
        </ul>

        <h2>2. Who We Are - Platform Operator, Not Service Provider</h2>
        <p>
          Plug A Pro is a <strong>technology marketplace and booking facilitation platform</strong>. We connect
          Customers with independent Providers. We are <strong>not</strong> the supplier of any field service.
          We do not employ Providers. Providers are independent contractors who supply services directly to
          Customers under the terms of the relevant Quote and Booking.
        </p>
        <p>
          When you book a service through Plug A Pro, the contract for the actual performance of that service
          is between you and the Provider. Plug A Pro&apos;s role is to facilitate the booking, facilitate
          payment where applicable, maintain the job record and provide support - not to perform the service
          itself.
        </p>
        <p>
          Plug A Pro does not guarantee the identity, qualifications, licensing, legality, safety or quality
          of any Provider&apos;s work except where Plug A Pro has <strong>expressly stated in writing on
          the Platform</strong> that a specific check has been completed.
        </p>

        <h2>3. Eligibility</h2>
        <p>
          You must be at least 18 years old and legally capable of entering into contracts under South African
          law to use the Platform. By using the Platform you confirm that you meet these requirements.
        </p>
        <p>
          Providers must hold any licences, registrations, permits or certifications required by South
          African law for the specific services they offer (for example: plumbers under applicable plumbing
          codes or any other trade where South African law requires a licence or registration).
        </p>

        <h2>4. How the Platform Works</h2>
        <ol>
          <li>A Customer submits a job request via WhatsApp or the web app, describing the service needed and providing a service address.</li>
          <li>Plug A Pro matches the request with one or more suitable nearby Providers based on skills, location and availability.</li>
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
          <li>Ensure the site is accessible, reasonably safe and suitable for the service to be performed.</li>
          <li>Treat Providers with dignity and respect. Abuse, threats or harassment will result in account suspension.</li>
          <li>Pay any agreed amounts at the times specified in the Quote and Booking confirmation.</li>
          <li>Do not attempt to hire Providers outside the Platform to circumvent Platform fees for services that were introduced through the Platform.</li>
        </ul>

        <h2>6. Provider Obligations</h2>
        <p>Providers are bound by the <a href="#provider-terms">Service Provider Terms (§ 28)</a>, which are a condition of using the Platform. Key obligations include:</p>
        <ul>
          <li>Maintain accurate profiles, pricing and availability information.</li>
          <li>Hold all licences, registrations, permits and insurance required by law.</li>
          <li>Perform services with reasonable care, skill, professionalism and in compliance with applicable safety and trade laws.</li>
          <li>Arrive on time. Notify Plug A Pro and the Customer promptly if unable to attend.</li>
          <li>Obtain Customer approval via the Platform before any work outside the original Quote scope.</li>
          <li>Not solicit Customers to bypass the Platform for Platform-introduced work.</li>
          <li>Cooperate with Plug A Pro&apos;s dispute and complaints process.</li>
        </ul>

        <h2>7. Quotes, Pricing and Extra Work</h2>
        <p>
          All Quotes are provided by Providers and represent their estimate for the described job.
          Quotes are not guaranteed fixed prices unless expressly labelled as fixed in the Platform record.
          Call-out fees, if applicable, are disclosed in the Quote.
        </p>
        <p>
          If a Provider identifies scope changes, additional work or unexpected conditions on-site, they
          must request approval through the Platform before proceeding. Any unapproved extras are between
          the Provider and the Customer. Plug A Pro facilitates but does not guarantee the outcome of
          unapproved scope changes.
        </p>

        <h2>8. Payments</h2>
        <p>
          Plug A Pro may facilitate customer service payments using third-party payment processors or
          payment reference providers shown at checkout. Plug A Pro does not store card numbers.
          Payment processor availability is subject to the processor&apos;s own terms, outages and fraud
          rules.
        </p>
        <p>
          Provider Credits are separate from customer service payments. Customers do not buy Provider
          Credits and Provider Credits are not a customer wallet for paying for services unless Plug A
          Pro expressly launches a separate customer credit product and publishes the applicable rules.
          See our <a href="/credits-policy">Provider Credits Terms and Rules</a> for the full rules
          governing Provider Credits, top-ups, deductions, expiry and reversals.
        </p>
        <p>
          If Plug A Pro facilitated payment and the service is not performed or is materially defective,
          you may be entitled to a refund in accordance with the{" "}
          <a href="#refunds">Refund and Cancellation rules in § 27</a> and applicable South African
          consumer law.
        </p>
        <p>
          If you paid a Provider directly (outside Platform-facilitated payment), Plug A Pro can review
          the dispute record but cannot process a direct refund for a payment it did not handle.
        </p>

        <h2>9. Cancellations and Refunds</h2>
        <p>
          Cancellation and refund rights depend on who cancels, when and whether service has commenced.
          See <a href="#refunds">§ 27 Refunds and Cancellations</a> below for the full matrix covering all
          scenarios, including Platform-facilitated customer payment refunds, Provider Credit reversals,
          Provider cancellations, Customer no-shows and partial completions.
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

        <h2>11. Provider Credits and Wallet</h2>
        <p>
          Provider Credits are a provider-side Platform mechanism. They are not cash, bank deposits,
          legal tender, loans or financial credit. Provider Credits are used by approved Providers to
          accept eligible customer-selected opportunities. They are not used by Customers to buy
          services from Plug A Pro. The full rules for Provider Credits, including types, top-ups,
          deductions, expiry, reversals and disputes, are set out in our{" "}
          <a href="/credits-policy">Provider Credits Terms and Rules</a>. That policy is incorporated
          into these Terms by reference.
        </p>

        <h2>12. WhatsApp, SMS and Communication</h2>
        <p>
          By using the Platform, you consent to receiving transactional WhatsApp messages about your
          bookings, job updates, payment confirmations and Platform activity (&ldquo;service messages&rdquo;).
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
          based on genuine experience. Reviews that contain false information, hate speech or personal
          attacks will be removed. Providers may report reviews for investigation. Plug A Pro&apos;s
          decision on reviews is final.
        </p>

        <h2>14. User Content</h2>
        <p>
          You may submit content to the Platform including job descriptions, photos and reviews. You grant
          Plug A Pro a non-exclusive, royalty-free licence to use that content for Platform operation, safety
          and improvement purposes. Job photos submitted by Providers are used to evidence job completion
          and support dispute resolution. They are retained for the period stated in our Privacy Policy and
          are not sold to third parties.
        </p>

        <h2>15. Prohibited Conduct</h2>
        <p>You must not:</p>
        <ul>
          <li>Provide false or misleading information at any point on the Platform.</li>
          <li>Use the Platform for any unlawful purpose or to facilitate illegal activity.</li>
          <li>Harass, threaten or abuse other users, Providers or Plug A Pro staff.</li>
          <li>Attempt to reverse-engineer, scrape, automate or disrupt the Platform.</li>
          <li>Create duplicate accounts to circumvent a suspension or ban.</li>
          <li>Abuse the refund, Provider Credit or dispute process (including fraudulent chargebacks or fabricated complaints).</li>
          <li>Solicit Providers or Customers to transact outside the Platform for Platform-introduced services.</li>
          <li>Use Provider Credits in a manner inconsistent with the Provider Credits Rules.</li>
        </ul>
        <p>Violations may result in account suspension, Provider Credit reversal or forfeiture where legally permitted and/or referral to law enforcement.</p>

        <h2>16. Platform Availability and Technical Limitations</h2>
        <p>
          The Platform is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We aim for high
          availability but do not guarantee uninterrupted access. Maintenance, updates or third-party
          infrastructure outages (Supabase, Vercel, Meta WhatsApp, payment processors) may cause temporary
          unavailability. We are not liable for losses caused by Platform downtime except where required
          by South African law.
        </p>

        <h2>17. Third-Party Services</h2>
        <p>
          Plug A Pro uses third-party services including Meta (WhatsApp), Supabase (database and
          authentication), Vercel (hosting), payment processors or payment reference providers and
          other processors described in our Privacy Policy. Your use of those services is also subject
          to their terms. Plug A Pro is not liable for third-party service failures, outages or data
          handling beyond the scope of our contractual arrangements with those parties and the
          requirements of South African law.
        </p>

        <h2>18. Disputes Between Customers and Providers</h2>
        <p>
          Because the service contract is between the Customer and the Provider, disputes about service
          quality, workmanship, damage or non-performance are primarily between those parties.
        </p>
        <p>
          Plug A Pro provides a support and escalation service. We will review the Platform record, job
          photos, communication history and any other available evidence. Where we facilitated payment,
          we may take steps to facilitate a resolution, including customer payment refunds, provider
          settlement holds or Provider Credit reversals, in accordance with our Refund and
          Cancellation Policy. We do not act as arbiters and our decisions are operational
          determinations, not legal judgments.
        </p>
        <p>
          Your rights under the Consumer Protection Act are not affected by this clause.
        </p>

        <h2>19. Limitation of Liability</h2>
        <p>
          Plug A Pro is a marketplace facilitator. We are not the supplier of field services and are not
          liable for the quality, safety, outcome or legality of work performed by Providers. Our
          maximum aggregate liability to you in connection with any specific job is limited to the amount
          we actually received and processed as payment for that job, except where law requires otherwise.
        </p>
        <p>
          We exclude liability for indirect, consequential, special or punitive damages to the maximum
          extent permitted by South African law. We do <strong>not</strong> exclude or limit liability for:
        </p>
        <ul>
          <li>death or personal injury caused by our own negligence;</li>
          <li>fraud or fraudulent misrepresentation by us;</li>
          <li>rights that cannot lawfully be excluded under the Consumer Protection Act or POPIA.</li>
        </ul>

        <h2>20. Indemnities</h2>
        <p>
          Customers indemnify Plug A Pro against claims, losses and costs arising from: the Customer&apos;s
          breach of these Terms; false information provided by the Customer; Customer conduct toward
          Providers; and any unsafe, unlawful or abusive site conditions the Customer creates or permits.
        </p>
        <p>
          Providers indemnify Plug A Pro against claims, losses and costs arising from: the Provider&apos;s
          negligence, poor workmanship or breach of law; damage to Customer property; Provider fraud;
          non-compliance with licensing or safety requirements; and any claim by a Customer arising from
          the Provider&apos;s services. See <a href="#provider-terms">§ 28 Service Provider Terms</a>
          below for the full provider indemnity clause.
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
          abuse the Provider Credit or refund systems or pose a risk to other users. We will give you advance
          notice where reasonably practical, except where we must act immediately to protect the Platform
          or other users.
        </p>
        <p>
          You may close your account at any time by contacting{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>. Closure is subject to our
          data retention obligations under POPIA and our <a href="/privacy">Privacy Policy</a>. Outstanding
          Provider Credits, disputes or payment obligations will be resolved before or at account closure.
        </p>

        <h2>23. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time to reflect legal, regulatory or product changes.
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
          All Platform content - including the Plug A Pro name, logo, software and interface design - is
          proprietary to Plug A Pro and may not be copied, reproduced or used without written permission,
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
          <a href="https://inforegulator.org.za/" target="_blank" rel="noopener noreferrer">
            inforegulator.org.za
          </a>.
        </p>
        <p>
          If a dispute cannot be resolved amicably, it will be subject to the jurisdiction of the South
          African courts.
        </p>

        <h2>26. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the Republic of South Africa. The Consumer Protection
          Act, POPIA, ECTA and other mandatory South African legislation apply where relevant.
        </p>

        <section id="refunds">
        <h2>27. Refunds and Cancellations</h2>
        <p>
          This section explains how cancellations, customer service payment refunds, provider credit
          reversals and disputes are handled on Plug A Pro. Your statutory rights under South African
          law, including the Consumer Protection Act 68 of 2008, apply throughout and override this
          section where required by law.
        </p>

        <h3>27.1 Platform role</h3>
        <p>
          Plug A Pro is a platform that helps customers find and book independent service providers.
          The service contract for the actual work is between the customer and the independent provider.
          Plug A Pro may facilitate intake, matching, quotes, communication, job records, support,
          provider credits and payments where implemented. Plug A Pro does not perform the service itself.
        </p>

        <h3>27.2 What Plug A Pro can and cannot refund</h3>
        <ul>
          <li><strong>Platform-facilitated customer payments:</strong> where Plug A Pro handled the customer payment, Plug A Pro may process or facilitate a refund according to this section, the Platform record, payment processor rules and applicable law.</li>
          <li><strong>Direct or off-platform payments:</strong> where the customer paid the provider directly, Plug A Pro can review the dispute record and support communication, but cannot refund money it never handled.</li>
          <li><strong>Provider credit purchases:</strong> provider credit reversals are handled under the <a href="/credits-policy">Provider Credits Terms and Rules</a>. They are separate from customer service payment refunds.</li>
          <li><strong>Provider lead-credit deductions:</strong> a lead-credit reversal restores provider credits in the provider wallet ledger where approved. It is not a refund to the customer.</li>
          <li><strong>Provider settlements:</strong> where Plug A Pro facilitated payment to a provider, provider settlement deductions may apply for provider-caused failures, refunds, chargebacks, fraud, no-shows or other breaches under the Service Provider Terms (§ 28).</li>
        </ul>

        <h3>27.3 How to request help</h3>
        <p>
          Contact support via WhatsApp or email at{" "}
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>. Include the booking, job,
          payment or lead reference; the reason for the cancellation, refund, reversal or dispute;
          and supporting evidence such as photos, screenshots, written quotes, job notes or messages.
          We aim to acknowledge requests within 1 business day and provide a decision or next step
          within 5 business days. Complex disputes may take longer where both sides need to respond.
        </p>

        <h3>27.4 Customer cancellation scenarios</h3>
        <p><strong>Before a provider is assigned or selected:</strong> if Plug A Pro facilitated payment and no provider has been assigned or selected, the customer will generally receive a full refund to the original payment method, subject to payment processor timing and applicable law.</p>
        <p><strong>After provider assignment or selection, but before dispatch:</strong> the customer will generally receive a refund less any cancellation or call-out fee that was clearly disclosed and approved in the quote or booking record, subject to applicable law.</p>
        <p><strong>After the provider is en route, has arrived or cannot access the site:</strong> a disclosed call-out fee, travel cost or reasonable preparation cost may be deducted where the Platform record supports it and the fee was properly disclosed. Customers must provide accurate address details, site access and a reasonably safe site.</p>
        <p><strong>Incorrect customer information:</strong> where work cannot proceed because the customer supplied materially incorrect information, Plug A Pro may facilitate a partial refund, settlement adjustment or cancellation outcome based on the quote, job record, provider evidence and applicable law.</p>

        <h3>27.5 Provider-caused cancellations and failures</h3>
        <p>
          If a provider cancels, does not arrive, lacks the required tools, skills, licence or
          availability or otherwise causes the job to fail, the customer may be entitled to a full or
          partial refund where Plug A Pro facilitated payment. Provider-caused failures are recorded and
          may result in provider suspension, removal, lead-credit consequences or settlement deductions.
        </p>

        <h3>27.6 Quality complaints and incomplete work</h3>
        <p>
          The provider is responsible for workmanship, site conduct, tools, licensing, insurance, safety
          compliance and legal compliance. Plug A Pro will facilitate a support process by reviewing the
          quote, written approvals, photos, job notes, WhatsApp messages, status updates and provider
          response. Where the Platform record supports the complaint and Plug A Pro facilitated payment,
          possible outcomes include rework discussions, full or partial refund, provider settlement hold,
          provider settlement deduction or account action. Plug A Pro does not become the provider of
          the service and does not guarantee workmanship or outcome unless expressly stated otherwise.
        </p>

        <h3>27.7 Extra work</h3>
        <p>
          Customers must approve extras in writing through the Platform before the provider performs
          that extra work. If extra work was approved and paid for but not completed, the customer may
          be entitled to a refund for the unperformed approved extras where Plug A Pro facilitated that
          payment. Verbal or off-platform extras are harder to support and may be treated as a direct
          customer-provider dispute.
        </p>

        <h3>27.8 Fraud, abuse, chargebacks and unsafe conduct</h3>
        <p>
          Plug A Pro may delay, refuse, reverse or investigate a refund, credit reversal or settlement
          where there is suspected fraud, abuse, fabricated evidence, unlawful conduct, payment reversal,
          chargeback, unsafe site conduct or breach of these Terms. Payment processor chargeback rules
          may override normal Platform timing.
        </p>

        <h3>27.9 Provider credit purchase reversals</h3>
        <p>
          Provider credit purchase reversals are separate from customer refunds. Purchased provider
          credits are generally non-refundable once bought, except where required by law or where Plug
          A Pro approves a reversal due to a clear platform or system error, duplicate payment, failed
          credit allocation, incorrect deduction, suspected fraud or chargeback reversal or another
          admin-approved exception.
        </p>

        <h3>27.10 Provider lead-credit deduction disputes</h3>
        <p>
          Providers may query a lead-credit deduction where the lead was invalid, duplicated, materially
          in the wrong category or location, linked to an invalid customer number, not actually requested
          by the customer, cancelled before unlock or affected by platform error. Approved disputes are
          restored as provider credits through the wallet ledger.
        </p>
        </section>

        <section id="provider-terms">
        <h2>28. Service Provider Terms</h2>
        <p>
          This section governs your use of the Plug A Pro platform as a service provider
          (&ldquo;Provider&rdquo;). It must be read alongside the{" "}
          <a href="/credits-policy">Provider Credits Terms and Rules</a> and the Refund and Cancellation
          rules in <a href="#refunds">§ 27</a> above. By registering as a Provider, accepting a job or
          using any part of the Platform, you agree to this section in full. If you do not agree, do not
          register or use the Platform as a Provider.
        </p>

        <h3>28.1 Your status as independent contractor</h3>
        <p>
          You are an <strong>independent contractor</strong>, not an employee, agent, partner,
          subcontractor or joint venture party of Plug A Pro. Plug A Pro does not control how you
          perform your work, your working hours, your equipment or your methods - we facilitate the
          introduction of customers to you and provide Platform tools to manage the booking and job
          record. You are responsible for your own tax affairs, SARS compliance, UIF and any other
          obligations applicable to you as a self-employed person or business. Plug A Pro is not your
          employer and does not withhold PAYE or make UIF contributions on your behalf.
        </p>

        <h3>28.2 Eligibility and onboarding requirements</h3>
        <p>To register and remain active as a Provider, you must:</p>
        <ul>
          <li>Be at least 18 years old and legally capable of entering into contracts.</li>
          <li>Have the right to work and operate a business in South Africa.</li>
          <li>Hold all licences, registrations, permits, certifications and insurance required by South African law for the services you offer (see § 28.3).</li>
          <li>Provide accurate information during registration and onboarding.</li>
          <li>Complete Plug A Pro&apos;s application review process to Plug A Pro&apos;s satisfaction.</li>
          <li>Maintain your profile, skills, availability and pricing accurately at all times.</li>
        </ul>

        <h3>28.3 Licences, qualifications and compliance</h3>
        <p>
          You must hold - and maintain in good standing - any licences, trade registrations, permits or
          certifications required by South African law for the specific type of work you perform.
          Examples include qualified plumbers where required under applicable plumbing codes and any
          other trade-specific or safety-related licences applicable to your services.{" "}
          <strong>You must not accept or perform work that requires a licence or registration you do
          not hold.</strong> Performing regulated work without the required licence is illegal and may
          result in criminal liability. Plug A Pro may deactivate your account if we become aware of
          non-compliance.
        </p>

        <h3>28.4 Insurance</h3>
        <p>
          You are strongly encouraged - and where required by law, obligated - to hold appropriate
          insurance for your trade and operations, including public liability insurance appropriate to
          the services you perform and any trade-specific or statutory insurance cover required for your
          category of work. Plug A Pro does not provide insurance cover for your activities. You are
          solely responsible for insuring yourself against claims, losses or liability arising from your
          work. Plug A Pro&apos;s marketplace insurance position is separate from your obligations.
        </p>

        <h3>28.5 Accurate profile and availability</h3>
        <p>
          Your profile on the Platform must accurately represent your skills, services, service areas,
          pricing, availability, qualifications and experience. You must update your availability when
          it changes. Misleading or false profile information is a breach of these Provider Terms and
          may result in suspension.
        </p>

        <h3>28.6 Accepting and performing jobs</h3>
        <p>When you accept a job lead and submit a Quote through the Platform:</p>
        <ul>
          <li>You confirm that you have the skills, tools, licences and availability to perform the work described.</li>
          <li>Your Quote is a binding offer once accepted by the Customer.</li>
          <li>You must attend at the agreed time. If you cannot attend, you must notify Plug A Pro and the Customer as early as possible via the Platform.</li>
          <li>You must perform the work with reasonable care, skill, professionalism and in compliance with all applicable safety and trade laws.</li>
        </ul>

        <h3>28.7 Duty of care and service standards</h3>
        <p>You must perform all services with reasonable care, skill and diligence appropriate to your trade; in a safe manner that does not endanger yourself, the Customer, bystanders or property; in compliance with all applicable South African laws, health and safety regulations and trade standards; honestly and transparently, without misleading the Customer about scope, pricing, materials or outcome; and using materials and equipment appropriate for the job (unless otherwise agreed).</p>
        <p>
          The Consumer Protection Act requires you to supply services that meet a reasonable quality
          standard. You are liable to the Customer for defective workmanship under applicable law. This
          liability is yours, not Plug A Pro&apos;s.
        </p>

        <h3>28.8 Extra work and scope changes</h3>
        <p>
          <strong>You must not carry out work outside the scope of the accepted Quote without first
          obtaining Customer approval through the Platform.</strong> If you discover additional work or
          scope changes on-site, stop and discuss the change with the Customer, submit a revised scope
          or extra-work request through the Platform, wait for the Customer&apos;s written approval
          before proceeding and do not pressure Customers to approve extras verbally or off-platform.
          Extra work performed without Customer approval through the Platform will not be facilitated
          for payment by Plug A Pro. Any resulting dispute is between you and the Customer.
        </p>

        <h3>28.9 Job status updates and evidence</h3>
        <p>You must keep the Platform job record up to date by updating your status when you are en route, when you arrive, when work starts and when work is complete; uploading before and after photos where requested by the Platform or where it is good practice for the type of work done; capturing any customer signatures or confirmations as required by the Platform workflow; and recording notes about site conditions, scope changes or material decisions made on-site. Accurate Platform records protect you in the event of a customer dispute. Incomplete records weaken your position.</p>

        <h3>28.10 Handling customer property</h3>
        <p>
          You are responsible for treating Customer property with care and respect. Any damage caused by
          your negligence, recklessness or misconduct is your liability. You must report damage you
          discover (whether caused by you or pre-existing) to the Customer and through the Platform as
          soon as you become aware of it.
        </p>

        <h3>28.11 Communication with customers</h3>
        <ul>
          <li>Use the Platform for all job-related communication where possible. This protects both you and the Customer by maintaining a written record.</li>
          <li>Be professional, respectful and honest in all communications.</li>
          <li>Do not harass, threaten or coerce Customers.</li>
          <li>Do not share Customer contact information with third parties.</li>
          <li>Do not use Customer contact details for any purpose other than performing the booked service.</li>
        </ul>

        <h3>28.12 Prohibited conduct</h3>
        <p>You must not:</p>
        <ul>
          <li>Provide false or misleading information about yourself, your qualifications or the services you provide.</li>
          <li>Accept jobs outside your skills, licences or legal permissions.</li>
          <li>Solicit Customers to transact outside the Platform for services introduced through the Platform (&ldquo;bypassing&rdquo;). This is a material breach and grounds for immediate termination.</li>
          <li>Agree to cash payments directly with Customers for Platform-booked jobs without Plug A Pro&apos;s approval (where Platform-facilitated payment applies).</li>
          <li>Misrepresent the Platform&apos;s role to Customers.</li>
          <li>Use the Platform to commit fraud, money laundering or any unlawful activity.</li>
          <li>Discriminate against Customers on grounds prohibited by South African law.</li>
          <li>Overcharge, add undisclosed costs or pressure Customers into approving unjustified extras.</li>
        </ul>

        <h3>28.13 Provider credits</h3>
        <p>
          Provider credits are provider-side platform units used to accept or access eligible
          customer-selected opportunities. They are not customer credits, payment for your work, cash,
          legal tender, a loan, a bank deposit or financial credit. A provider credit is deducted only
          when a Customer selects you and you complete final acceptance of that customer-selected
          opportunity through the Platform, WhatsApp or Provider Portal. Previewing a lead, showing
          interest, being shortlisted, Customer selection before your final acceptance, declining or
          expiry does not use credits. Purchased credits are generally non-refundable once bought,
          except where required by law or under the exceptions listed in § 27.9 above. Full provider
          credit rules are in the <a href="/credits-policy">Provider Credits Terms and Rules</a>.
        </p>

        <h3>28.14 Payment settlement and deductions</h3>
        <p>
          Where Plug A Pro facilitates customer payment, your payment for completed jobs is processed
          according to the settlement terms communicated at onboarding. Provider credits are separate
          from customer service payments and do not replace your quote or settlement terms. Plug A Pro
          may deduct from your settlement: Platform service fees or commission as agreed; amounts
          corresponding to refunds paid to Customers for Provider-caused failures (non-attendance, poor
          workmanship, damage), subject to investigation and notification; chargebacks or reversed
          payments where you were involved in fraud or misconduct; and outstanding amounts owed to Plug
          A Pro under these Provider Terms. Plug A Pro will notify you of any deductions and give you an
          opportunity to respond before a deduction is made, except where immediate action is required
          to prevent further harm.
        </p>

        <h3>28.15 Customer complaints, disputes and rework</h3>
        <p>
          You must cooperate with Plug A Pro&apos;s complaints and dispute process. This includes
          responding to Plug A Pro support queries within 2 business days, providing your account of
          events, evidence and photos from the job and cooperating with any inspection or rework
          required. Where a Customer&apos;s complaint about workmanship quality is upheld, you may be
          required to remedy the defect at no additional charge to the Customer. Failure to cooperate
          may result in suspension, deduction from future settlements or removal from the Platform.
        </p>

        <h3>28.16 Indemnity in favour of Plug A Pro</h3>
        <p>You indemnify Plug A Pro and hold us harmless against all claims, losses, costs, damages and legal fees arising from your negligence, poor workmanship, misconduct or breach of these Provider Terms; damage to Customer property caused by you; personal injury caused by your actions or omissions; your failure to hold required licences, certifications or insurance; your breach of any applicable South African law; fraud, misrepresentation or deception by you; and any Customer claim arising from the services you performed or failed to perform.</p>

        <h3>28.17 Suspension and termination</h3>
        <p>
          Plug A Pro may suspend or terminate your Provider account where you breach these Provider
          Terms or the Terms of Service; engage in fraudulent, abusive or unlawful activity; accumulate
          repeated complaints, cancellations or no-shows; fail to maintain required licences, insurance
          or qualifications; attempt to bypass the Platform; or pose a risk to Customers, other
          Providers or Plug A Pro. Where practical, we will give you notice and an opportunity to
          respond before suspending or terminating your account. Immediate suspension may occur without
          prior notice where there is a risk of harm or where urgent action is needed.
        </p>

        <h3>28.18 Confidentiality and data protection</h3>
        <p>Customer personal information (including names, addresses and contact details) shared with you through the Platform is provided solely for the purpose of performing the booked service. You must not use Customer personal information for any other purpose, must not share Customer personal information with third parties, must comply with POPIA in your handling of Customer data and must promptly notify Plug A Pro if you become aware of a data breach involving Customer information.</p>

        <h3>28.19 Plug A Pro audit rights</h3>
        <p>
          Plug A Pro may review your Platform records, job history, customer feedback, payment records
          and profile information for compliance, safety and quality assurance purposes. We may request
          proof of licences, certifications or insurance at any time.
        </p>

        <h3>28.20 Changes to these Provider Terms</h3>
        <p>
          We may update this section from time to time. Material changes will be communicated via
          WhatsApp or a notice on the Platform at least 14 days before they take effect. Continued use
          of the Platform as a Provider after the effective date constitutes acceptance.
        </p>
        </section>

        <h2>29. Contact</h2>
        <p>
          Legal: <a href="mailto:legal@plugapro.co.za">legal@plugapro.co.za</a><br />
          Support: <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a><br />
          Privacy: <a href="mailto:privacy@plugapro.co.za">privacy@plugapro.co.za</a><br />
          Plug A Pro - Registered in South Africa
        </p>
      </div>
    </div>
  );
}
