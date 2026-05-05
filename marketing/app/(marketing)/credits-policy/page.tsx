import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Provider Credits Terms and Rules" });

export default function CreditsPolicyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Provider Credits Terms and Rules</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: 5 May 2026</p>

        <p>
          Plug A Pro credits are prepaid platform units used by approved service providers to accept
          customer-selected jobs. Credits are not cash, loans, financing arrangement, or financial credit.
        </p>

        <h2>1. Credits value</h2>
        <p>
          <strong>1 credit = R50.</strong> Credits are displayed in the provider wallet and credits
          history inside the Worker Portal.
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
          have separate rules communicated when they are awarded.
        </p>

        <h2>4. Credits are not financial credit</h2>
        <p>
          Plug A Pro does not lend money, advance funds, run credit checks, or provide a credit
          facility through provider credits. Credits cannot be withdrawn as cash, transferred, sold,
          or treated as a bank deposit or loan.
        </p>

        <h2>5. Credits history and support</h2>
        <p>
          Providers can view their credits balance and credits history in the Worker Portal. If you
          believe credits were used incorrectly, contact Plug A Pro support with the job reference and
          a short explanation.
        </p>

        <h2>6. Changes</h2>
        <p>
          Plug A Pro may update provider credits terms and rules with notice. Continued use of the
          Worker Portal, WhatsApp provider actions, or provider tools after notice means the updated
          rules apply.
        </p>
      </div>
    </div>
  );
}
