import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({
  title: "How Service Delivery Works",
  description:
    "Service area, response times, arrival windows, rescheduling and completion for Plug A Pro bookings.",
});

export default function ServicePolicyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">How Service Delivery Works</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <h2>Where we operate</h2>
        <p>
          Plug A Pro currently serves <strong>Johannesburg West / Roodepoort</strong>.
          If your address is outside this area, we add you to our waitlist and
          notify you when we launch near you. See{" "}
          <a href="/areas/johannesburg">service areas</a>.
        </p>

        <h2>Requesting a service</h2>
        <p>
          You describe the job and your address; we match you with a vetted
          provider. Matching normally completes within business hours the same
          day. If no provider is available we tell you rather than leave you
          waiting.
        </p>

        <h2>Quotes and acceptance</h2>
        <p>
          Providers quote before work starts. A quote shows labour, materials and
          validity. Work begins only after you accept.
        </p>

        <h2>Arrival windows</h2>
        <p>
          Bookings are scheduled into an agreed arrival window. If a provider is
          running late you are notified; repeated lateness affects the
          provider&apos;s standing on the platform.
        </p>

        <h2>Rescheduling and cancellation</h2>
        <p>
          You can reschedule or cancel before the provider is en route. Fees, when
          they apply, are set out in the{" "}
          <a href="/refund-policy">Refunds &amp; Cancellations policy</a>.
        </p>

        <h2>Completion and disputes</h2>
        <p>
          A job is complete when the agreed scope is done and you confirm it. If
          something is wrong, raise it within the dispute window described in the{" "}
          <a href="/terms">Terms of Service</a> and we will step in.
        </p>

        <h2>Contact</h2>
        <p>
          <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a> ·
          WhatsApp <a href="https://wa.me/27693552447">+27 69 355 2447</a>
        </p>
      </div>
    </div>
  );
}
