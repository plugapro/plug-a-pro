import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "How It Works",
  description:
    "See how Plug A Pro moves a request from WhatsApp intake through operations review, provider matching, credit unlock, acceptance, quote approval and job updates.",
});

const CUSTOMER_STEPS = [
  {
    step: "1",
    title: "Start on WhatsApp or the PWA",
    detail:
      "Tell Plug A Pro what service you need, where the job is, your preferred availability and add photos if they help explain the work.",
  },
  {
    step: "2",
    title: "A structured request is created",
    detail:
      "Your request becomes a job request in the operations queue. The team can review the details before dispatch, especially when the request needs clarification.",
  },
  {
    step: "3",
    title: "A provider accepts",
    detail:
      "Only providers approved for marketplace access can receive live leads. They see a limited preview first, then unlock and accept before full contact details are released.",
  },
  {
    step: "4",
    title: "You receive the handover",
    detail:
      "After a successful acceptance, you get the provider's name, contact details and a secure link to view the handover for that request.",
  },
  {
    step: "5",
    title: "Approve quotes or extra work",
    detail:
      "Quotes and extra work requests are sent for your approval in writing before the job moves forward.",
  },
  {
    step: "6",
    title: "Track the job status",
    detail:
      "You receive WhatsApp updates when the provider schedules arrival, is on the way, arrives, starts the job and completes the work.",
  },
  {
    step: "7",
    title: "Confirm completion",
    detail:
      "The final job record keeps the quote, status updates, notes, photos and completion history together for follow-up and support.",
  },
];

const PROVIDER_STEPS = [
  {
    step: "1",
    title: "Start provider onboarding on WhatsApp",
    detail:
      "Share your name, trade categories, service areas, experience, availability and evidence such as documents or photos.",
  },
  {
    step: "2",
    title: "Operations reviews the application",
    detail:
      "Plug A Pro reviews the submission in the admin console. If it is rejected, the provider is notified and cannot access marketplace leads.",
  },
  {
    step: "3",
    title: "Providers activate their profile",
    detail:
      "After marketplace access is approved, the provider record is activated. The provider can open the Provider PWA, sign in with phone OTP, review their profile, set availability and check wallet credits.",
  },
  {
    step: "4",
    title: "Wallet credits make a provider lead-ready",
    detail:
      "Providers need available credits before they can unlock paid leads. If there are not enough credits, they create a top-up intent and upload proof where required.",
  },
  {
    step: "5",
    title: "Receive a lead preview",
    detail:
      "When a matching customer request enters dispatch, eligible providers receive a WhatsApp lead notification and can open a secure lead link.",
  },
  {
    step: "6",
    title: "Unlock, then accept or decline",
    detail:
      "Before full customer details are shown, the system checks provider status, KYC/application state, wallet balance and lead availability. If checks pass, the wallet is debited, the unlock is recorded and the provider can accept.",
  },
  {
    step: "7",
    title: "Handover and job execution",
    detail:
      "After acceptance, the customer is notified, operations visibility is updated and the provider can contact the customer, quote, schedule arrival, upload notes or photos and update job progress.",
  },
];

const OPS_STEPS = [
  {
    step: "1",
    title: "Review incoming requests",
    detail:
      "Customer job requests enter an operations view where the team can check service type, location, timing, notes and uploaded photos.",
  },
  {
    step: "2",
    title: "Dispatch and matching",
    detail:
      "The dispatch queue can use matching rules or manual override to route the request to providers who cover the category, area and availability window.",
  },
  {
    step: "3",
    title: "Keep live and test cohorts separate",
    detail:
      "Marketplace routing keeps internal test users away from live customer/provider traffic so production matching stays clean.",
  },
  {
    step: "4",
    title: "Monitor acceptance, quotes and payments",
    detail:
      "Operations tracks accepted leads, quote progress, booking/payment status, provider wallet activity, disputes and provider application review.",
  },
];

const DECISION_GATES = [
  {
    title: "Application gate",
    detail:
      "Pending, rejected, inactive or suspended providers cannot receive marketplace leads. Approval or rejection is sent back through WhatsApp.",
  },
  {
    title: "Credit unlock gate",
    detail:
      "A paid lead must be unlocked with credits before a provider can accept it or see full customer contact details.",
  },
  {
    title: "Acceptance handover gate",
    detail:
      "Customer notification and provider contact release happen only after the provider is assigned and the acceptance is committed.",
  },
];

function FlowSection({
  label,
  title,
  steps,
}: {
  label: string;
  title: string;
  steps: { step: string; title: string; detail: string }[];
}) {
  return (
    <div className="mb-16">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
        {label}
      </p>
      <h2 className="text-2xl md:text-3xl font-bold mb-8">{title}</h2>
      <div className="space-y-0">
        {steps.map((s, i) => (
          <div key={s.step} className="flex gap-5">
            <div className="flex flex-col items-center">
              <div
                className="size-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{
                  background:
                    "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-purple) 50%, var(--accent-brand) 100%)",
                }}
              >
                {s.step}
              </div>
              {i < steps.length - 1 && (
                <div className="w-px flex-1 bg-border/60 my-1" />
              )}
            </div>
            <div className="pb-8">
              <h3 className="font-semibold mb-1">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {s.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <>
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          WhatsApp, operations, PWA
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          How Plug A Pro works
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg">
          The real flow from customer request to provider approval, lead unlock, acceptance, handover, quote and job updates.
        </p>
      </div>

      <div className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="mb-16 rounded-2xl border border-border/40 bg-muted/30 p-6 md:p-8">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              The short version
            </p>
            <div className="grid gap-4 md:grid-cols-4">
              {[
                "Customer creates a request",
                "Ops reviews and dispatches",
                "Approved provider unlocks the lead",
                "Both sides move into handover and job updates",
              ].map((item, index) => (
                <div key={item} className="rounded-xl border border-border/40 bg-background/60 p-4">
                  <p className="text-xs text-muted-foreground mb-2">Step {index + 1}</p>
                  <p className="text-sm font-medium">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <FlowSection
            label="Your customer journey"
            title="From request to handover and job updates"
            steps={CUSTOMER_STEPS}
          />
          <FlowSection
            label="Provider journey"
            title="From WhatsApp onboarding to credit-unlocked leads"
            steps={PROVIDER_STEPS}
          />
          <FlowSection
            label="Operations journey"
            title="Review, dispatch, wallet review and monitoring"
            steps={OPS_STEPS}
          />

          <div className="mb-16">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
              Important checks
            </p>
            <h2 className="text-2xl md:text-3xl font-bold mb-8">
              The gates that keep the marketplace controlled
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {DECISION_GATES.map((gate) => (
                <div key={gate.title} className="rounded-2xl border border-border/40 p-6 bg-muted/20">
                  <h3 className="font-semibold mb-2">{gate.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {gate.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 p-6 bg-muted/30 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground mb-2">
              Full customer details are released in stages
            </p>
            <p>
              A provider first sees a limited lead preview. Full customer contact details are released after the provider passes the eligibility checks, unlocks the lead where required and accepts the job. Plug A Pro keeps the request, quote approval, job updates and handover activity on record.
            </p>
          </div>
        </div>
      </div>

      <CTAStrip />
    </>
  );
}
