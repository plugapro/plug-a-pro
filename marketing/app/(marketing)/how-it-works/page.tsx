import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "How It Works",
  description:
    "How Plug-A-Pro matches customers to nearby independent workers for small home jobs — from WhatsApp request to completed job.",
});

const CUSTOMER_STEPS = [
  {
    step: "1",
    title: "Describe your job on WhatsApp",
    detail:
      "Message Plug-A-Pro on WhatsApp. A guided flow helps you describe what needs doing, where you are, and when you need it. Add photos if it helps. Takes under 3 minutes.",
  },
  {
    step: "2",
    title: "Choose your service category",
    detail:
      "Select the type of job — plumbing, painting, electrical, gardening, general handyman, and more. We use this to match you with the right skills.",
  },
  {
    step: "3",
    title: "Confirm your address and timing",
    detail:
      "Tell us your suburb and preferred time. We find workers who are nearby and available when you need them.",
  },
  {
    step: "4",
    title: "Get matched to a nearby worker",
    detail:
      "Your job request goes to available workers in your area with the right skills. The first suitable worker to accept gets the lead.",
  },
  {
    step: "5",
    title: "Review the worker's profile",
    detail:
      "See the worker's verified skills, reviews from previous jobs, and how long they've been on the platform. Decide whether to proceed.",
  },
  {
    step: "6",
    title: "Receive and approve a quote",
    detail:
      "For fixed-price jobs, you see the rate upfront. For custom jobs, the worker submits a quote — you approve before any work begins.",
  },
  {
    step: "7",
    title: "Worker arrives and does the job",
    detail:
      "You receive WhatsApp updates when the worker is on their way and when they've arrived. Job status tracked throughout.",
  },
  {
    step: "8",
    title: "Rate the job when it's done",
    detail:
      "After the job is marked complete, you receive a follow-up to leave a rating. Your feedback builds the worker's verified reputation.",
  },
];

const WORKER_STEPS = [
  {
    step: "1",
    title: "Register via WhatsApp or the web",
    detail:
      "Message Plug-A-Pro on WhatsApp or sign up on the website. A guided flow captures your name, skills, service area, and availability.",
  },
  {
    step: "2",
    title: "Define your skills and coverage area",
    detail:
      "Tell us what types of jobs you do and which areas you work in. The platform uses this to match you with relevant local job leads.",
  },
  {
    step: "3",
    title: "Wait for your application to be reviewed",
    detail:
      "We review applications within 24 hours. Once approved, you can start receiving job leads immediately.",
  },
  {
    step: "4",
    title: "Receive job leads on WhatsApp",
    detail:
      "When a customer posts a job that matches your skills and area, you receive a lead on WhatsApp. You choose to accept or pass — no obligation.",
  },
  {
    step: "5",
    title: "Accept the lead and contact the customer",
    detail:
      "Once you accept, you communicate with the customer through the platform. Customer details are shared once you're matched — both sides stay protected.",
  },
  {
    step: "6",
    title: "Arrange an inspection if needed",
    detail:
      "For jobs that need a site visit before quoting, you can schedule an inspection. The customer approves the time through the platform.",
  },
  {
    step: "7",
    title: "Submit your quote",
    detail:
      "Once you've assessed the job, submit your quote through the platform. Customer approves before you start. No verbal agreements.",
  },
  {
    step: "8",
    title: "Do the job and build your reputation",
    detail:
      "Update job status as you work. Before and after photos create a record. Customer leaves a rating. Good ratings earn you more leads over time.",
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
                    "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-brand) 100%)",
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
              <p className="text-sm text-muted-foreground leading-relaxed">{s.detail}</p>
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
          The full picture
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">How Plug-A-Pro works</h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg">
          A marketplace that connects homeowners to independent local workers for small home jobs. Here&apos;s how both sides experience it.
        </p>
      </div>

      <div className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <FlowSection
            label="Customer flow"
            title="From WhatsApp message to job done"
            steps={CUSTOMER_STEPS}
          />
          <FlowSection
            label="Worker flow"
            title="From registration to a full pipeline of leads"
            steps={WORKER_STEPS}
          />

          <div className="rounded-2xl border border-border/40 p-6 bg-muted/30 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground mb-2">Privacy and trust</p>
            <p>
              Customer and worker communicate through the platform. Personal phone numbers are not shared by default. Both sides can interact safely and structure the job clearly before meeting in person.
            </p>
          </div>
        </div>
      </div>

      <CTAStrip />
    </>
  );
}
