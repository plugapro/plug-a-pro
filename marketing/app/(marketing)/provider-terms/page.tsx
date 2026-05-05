import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Service Provider Terms" });

export default function ProviderTermsPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Service Provider Terms and Conditions</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 29 April 2026</p>

        <p>
          These Service Provider Terms and Conditions (&ldquo;Provider Terms&rdquo;) govern your use of
          the Plug A Pro platform as a service provider (&ldquo;Provider&rdquo;). They are part of our{" "}
          <a href="/terms">Terms of Service</a> and must be read alongside the{" "}
          <a href="/credits-policy">Provider Credits Terms and Rules</a> and{" "}
          <a href="/refund-policy">Refund and Cancellation Policy</a>.
        </p>
        <p>
          By registering as a Provider, accepting a job, or using any part of the Platform, you agree
          to these Provider Terms in full. If you do not agree, do not register or use the Platform
          as a Provider.
        </p>

        <h2>1. Your Status as Independent Contractor</h2>
        <p>
          You are an <strong>independent contractor</strong>, not an employee, agent, partner, or
          joint venture party of Plug A Pro. Plug A Pro does not control how you perform your work,
          your working hours, your equipment, or your methods — we facilitate the introduction of
          customers to you and provide Platform tools to manage the booking and job record.
        </p>
        <p>
          You are responsible for your own tax affairs, SARS compliance, UIF, and any other
          obligations applicable to you as a self-employed person or business. Plug A Pro is not your
          employer and does not withhold PAYE or make UIF contributions on your behalf.
        </p>

        <h2>2. Eligibility and Onboarding Requirements</h2>
        <p>To register and remain active as a Provider, you must:</p>
        <ul>
          <li>Be at least 18 years old and legally capable of entering into contracts.</li>
          <li>Have the right to work and operate a business in South Africa.</li>
          <li>Hold all licences, registrations, permits, certifications, and insurance required by South African law for the services you offer (see section 4).</li>
          <li>Provide accurate information during registration and onboarding.</li>
          <li>Complete Plug A Pro&apos;s application review process to Plug A Pro&apos;s satisfaction.</li>
          <li>Maintain your profile, skills, availability, and pricing accurately at all times.</li>
        </ul>

        <h2>3. Licences, Qualifications, and Compliance</h2>
        <p>
          You must hold — and maintain in good standing — any licences, trade registrations, permits,
          or certifications required by South African law for the specific type of work you perform.
          Examples include (without limitation):
        </p>
        <ul>
          <li>Registered electricians under the Electrical Installation Regulations</li>
          <li>Qualified plumbers where required under applicable plumbing codes</li>
          <li>LPG gas installers under relevant gas installation regulations</li>
          <li>Any other trade-specific or safety-related licences applicable to your services</li>
        </ul>
        <p>
          <strong>You must not accept or perform work that requires a licence or registration you do
          not hold.</strong> Performing regulated work without the required licence is illegal and may
          result in criminal liability. Plug A Pro may deactivate your account if we become aware of
          non-compliance.
        </p>

        <h2>4. Insurance</h2>
        <p>
          You are strongly encouraged — and where required by law, obligated — to hold appropriate
          insurance for your trade and operations, including:
        </p>
        <ul>
          <li>Public liability insurance appropriate to the services you perform</li>
          <li>Any trade-specific or statutory insurance cover required for your category of work</li>
        </ul>
        <p>
          Plug A Pro does not provide insurance cover for your activities. You are solely responsible
          for insuring yourself against claims, losses, or liability arising from your work. Plug A
          Pro&apos;s marketplace insurance position is separate from your obligations.
        </p>

        <h2>5. Accurate Profile and Availability</h2>
        <p>
          Your profile on the Platform must accurately represent your skills, services, service areas,
          pricing, availability, qualifications, and experience. You must update your availability when
          it changes. Misleading or false profile information is a breach of these Provider Terms and
          may result in suspension.
        </p>

        <h2>6. Accepting and Performing Jobs</h2>
        <p>
          When you accept a job lead and submit a Quote through the Platform:
        </p>
        <ul>
          <li>You confirm that you have the skills, tools, licences, and availability to perform the work described.</li>
          <li>Your Quote is a binding offer once accepted by the Customer.</li>
          <li>You must attend at the agreed time. If you cannot attend, you must notify Plug A Pro and the Customer as early as possible via the Platform.</li>
          <li>You must perform the work with reasonable care, skill, professionalism, and in compliance with all applicable safety and trade laws.</li>
        </ul>

        <h2>7. Duty of Care and Service Standards</h2>
        <p>
          You must perform all services:
        </p>
        <ul>
          <li>with reasonable care, skill, and diligence appropriate to your trade;</li>
          <li>in a safe manner that does not endanger yourself, the Customer, bystanders, or property;</li>
          <li>in compliance with all applicable South African laws, health and safety regulations, and trade standards;</li>
          <li>honestly and transparently, without misleading the Customer about scope, pricing, materials, or outcome;</li>
          <li>using materials and equipment appropriate for the job (unless otherwise agreed).</li>
        </ul>
        <p>
          The Consumer Protection Act requires you to supply services that meet a reasonable quality
          standard. You are liable to the Customer for defective workmanship under applicable law.
          This liability is yours, not Plug A Pro&apos;s.
        </p>

        <h2>8. Extra Work and Scope Changes</h2>
        <p>
          <strong>You must not carry out work outside the scope of the accepted Quote without first
          obtaining Customer approval through the Platform.</strong>
        </p>
        <p>
          If you discover additional work or scope changes on-site:
        </p>
        <ul>
          <li>Stop and discuss the change with the Customer.</li>
          <li>Submit a revised scope or extra-work request through the Platform.</li>
          <li>Wait for the Customer&apos;s written approval before proceeding with additional work.</li>
          <li>Do not pressure Customers to approve extras verbally or off-platform.</li>
        </ul>
        <p>
          Extra work performed without Customer approval through the Platform will not be facilitated
          for payment by Plug A Pro. Any resulting dispute is between you and the Customer.
        </p>

        <h2>9. Job Status Updates and Evidence</h2>
        <p>You must keep the Platform job record up to date by:</p>
        <ul>
          <li>Updating your status when you are en route, when you arrive, when work starts, and when work is complete.</li>
          <li>Uploading before and after photos where requested by the Platform or where it is good practice for the type of work done.</li>
          <li>Capturing any customer signatures or confirmations as required by the Platform workflow.</li>
          <li>Recording notes about site conditions, scope changes, or material decisions made on-site.</li>
        </ul>
        <p>
          Accurate Platform records protect you in the event of a customer dispute. Incomplete records
          weaken your position.
        </p>

        <h2>10. Handling Customer Property</h2>
        <p>
          You are responsible for treating Customer property with care and respect. Any damage caused by
          your negligence, recklessness, or misconduct is your liability. You must report damage you
          discover (whether caused by you or pre-existing) to the Customer and through the Platform as
          soon as you become aware of it.
        </p>

        <h2>11. Communication with Customers</h2>
        <ul>
          <li>Use the Platform for all job-related communication where possible. This protects both you and the Customer by maintaining a written record.</li>
          <li>Be professional, respectful, and honest in all communications.</li>
          <li>Do not harass, threaten, or coerce Customers.</li>
          <li>Do not share Customer contact information with third parties.</li>
          <li>Do not use Customer contact details for any purpose other than performing the booked service.</li>
        </ul>

        <h2>12. Prohibited Conduct</h2>
        <p>You must not:</p>
        <ul>
          <li>Provide false or misleading information about yourself, your qualifications, or the services you provide.</li>
          <li>Accept jobs outside your skills, licences, or legal permissions.</li>
          <li>Solicit Customers to transact outside the Platform for services introduced through the Platform (&ldquo;bypassing&rdquo;). This is a material breach and grounds for immediate termination.</li>
          <li>Agree to cash payments directly with Customers for Platform-booked jobs without Plug A Pro&apos;s approval (where Platform-facilitated payment applies).</li>
          <li>Misrepresent the Platform&apos;s role to Customers.</li>
          <li>Use the Platform to commit fraud, money laundering, or any unlawful activity.</li>
          <li>Discriminate against Customers on grounds prohibited by South African law.</li>
          <li>Overcharge, add undisclosed costs, or pressure Customers into approving unjustified extras.</li>
        </ul>

        <h2>13. Credits and Credit-Funded Bookings</h2>
        <p>
          Bookings may be funded in whole or in part by Customer Credits. You accept such bookings as
          fully valid Platform bookings. Your payment entitlement for completed work is governed by the
          Provider settlement terms communicated during onboarding — your pay is not dependent on the
          Customer&apos;s credits balance or credit type.
        </p>
        <p>
          You must not refuse a confirmed Booking solely because Credits were used as the payment method.
        </p>

        <h2>14. Payment Settlement and Deductions</h2>
        <p>
          Your payment for completed jobs is processed by Plug A Pro according to the settlement terms
          communicated at onboarding. Plug A Pro may deduct from your settlement:
        </p>
        <ul>
          <li>Platform service fees or commission as agreed</li>
          <li>Amounts corresponding to refunds paid to Customers for Provider-caused failures (non-attendance, poor workmanship, damage), subject to investigation and notification</li>
          <li>Chargebacks or reversed payments where you were involved in fraud or misconduct</li>
          <li>Outstanding amounts owed to Plug A Pro under these Provider Terms</li>
        </ul>
        <p>
          Plug A Pro will notify you of any deductions and give you an opportunity to respond before
          a deduction is made, except where immediate action is required to prevent further harm.
        </p>

        <h2>15. Customer Complaints, Disputes, and Rework</h2>
        <p>
          You must cooperate with Plug A Pro&apos;s complaints and dispute process. This includes:
        </p>
        <ul>
          <li>Responding to Plug A Pro support queries within 2 business days</li>
          <li>Providing your account of events, evidence, and photos from the job</li>
          <li>Cooperating with any inspection or rework required</li>
        </ul>
        <p>
          Where a Customer&apos;s complaint about workmanship quality is upheld, you may be required to
          remedy the defect at no additional charge to the Customer. Failure to cooperate may result in
          suspension, deduction from future settlements, or removal from the Platform.
        </p>

        <h2>16. Indemnity in Favour of Plug A Pro</h2>
        <p>
          You indemnify Plug A Pro and hold us harmless against all claims, losses, costs, damages,
          and legal fees arising from:
        </p>
        <ul>
          <li>your negligence, poor workmanship, misconduct, or breach of these Provider Terms;</li>
          <li>damage to Customer property caused by you;</li>
          <li>personal injury caused by your actions or omissions;</li>
          <li>your failure to hold required licences, certifications, or insurance;</li>
          <li>your breach of any applicable South African law;</li>
          <li>fraud, misrepresentation, or deception by you;</li>
          <li>any Customer claim arising from the services you performed or failed to perform.</li>
        </ul>

        <h2>17. Suspension and Termination</h2>
        <p>
          Plug A Pro may suspend or terminate your Provider account where you:
        </p>
        <ul>
          <li>breach these Provider Terms or the Terms of Service;</li>
          <li>engage in fraudulent, abusive, or unlawful activity;</li>
          <li>accumulate repeated complaints, cancellations, or no-shows;</li>
          <li>fail to maintain required licences, insurance, or qualifications;</li>
          <li>attempt to bypass the Platform;</li>
          <li>pose a risk to Customers, other Providers, or Plug A Pro.</li>
        </ul>
        <p>
          Where practical, we will give you notice and an opportunity to respond before suspending or
          terminating your account. Immediate suspension may occur without prior notice where there is
          a risk of harm or where urgent action is needed.
        </p>

        <h2>18. Confidentiality and Data Protection</h2>
        <p>
          Customer personal information (including names, addresses, and contact details) shared with
          you through the Platform is provided solely for the purpose of performing the booked service.
          You must:
        </p>
        <ul>
          <li>Not use Customer personal information for any other purpose</li>
          <li>Not share Customer personal information with third parties</li>
          <li>Comply with POPIA in your handling of Customer data</li>
          <li>Promptly notify Plug A Pro if you become aware of a data breach involving Customer information</li>
        </ul>

        <h2>19. Plug A Pro Audit Rights</h2>
        <p>
          Plug A Pro may review your Platform records, job history, customer feedback, payment records,
          and profile information for compliance, safety, and quality assurance purposes. We may request
          proof of licences, certifications, or insurance at any time.
        </p>

        <h2>20. Changes to Provider Terms</h2>
        <p>
          We may update these Provider Terms from time to time. Material changes will be communicated
          via WhatsApp or a notice on the Platform at least 14 days before they take effect. Continued
          use of the Platform as a Provider after the effective date constitutes acceptance.
        </p>

        <h2>21. Contact</h2>
        <p>
          Provider support: <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a><br />
          Legal: <a href="mailto:legal@plugapro.co.za">legal@plugapro.co.za</a><br />
          Plug A Pro — Registered in South Africa
        </p>
      </div>
    </div>
  );
}
