import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "How It Works",
  description:
    "See how Plug-A-Pro connects customers to nearby home-job workers — from describing the job to getting it done safely.",
});

const CUSTOMER_STEPS = [
  {
    step: "1",
    title: "Describe your job",
    detail:
      "Send a message to the Plug-A-Pro WhatsApp number or use the web form. Tell us what needs doing, where you are, and your preferred timing. Attach a photo if it helps — especially useful for repairs and DIY rescues.",
  },
  {
    step: "2",
    title: "Get matched to a nearby worker",
    detail:
      "The platform finds available workers near you who have the right skills. A lead is sent to up to four matching workers simultaneously. You're notified when one accepts.",
  },
  {
    step: "3",
    title: "Inspect (if needed) and get a quote",
    detail:
      "For jobs that are hard to price remotely, the worker can visit to inspect first — no cost until you accept a quote. For simpler jobs, a quote is sent directly. You see the price and description before committing.",
  },
  {
    step: "4",
    title: "Approve the quote",
    detail:
      "You approve in writing through the platform before any work starts. If the scope changes on-site, the worker must request your approval before proceeding with extra work.",
  },
  {
    step: "5",
    title: "Track the job live",
    detail:
      "You receive WhatsApp updates at every milestone: worker on the way, arrived, job started, completed. No more chasing for ETAs.",
  },
  {
    step: "6",
    title: "Pay and leave a review",
    detail:
      "Pay after the job is done. Leave a rating and comment to help build the worker's reputation — and help the next customer make a confident choice.",
  },
];

const WORKER_STEPS = [
  {
    step: "1",
    title: "Sign up on WhatsApp or online",
    detail:
      "Tell us your name, what kind of jobs you do, which areas you work in, and when you're normally free. You don't need a registered business — just your skills and a phone.",
  },
  {
    step: "2",
    title: "We check your application",
    detail:
      "We look at what you sent before we start sending you work. Once you're approved, your profile goes live and you're ready to get jobs in your area.",
  },
  {
    step: "3",
    title: "Get a job notification on WhatsApp",
    detail:
      "When a nearby customer needs your kind of work, you'll get a WhatsApp message. It shows the type of job, the area, and how soon they need it — but not the customer's personal number yet.",
  },
  {
    step: "4",
    title: "Say yes or no to the job",
    detail:
      "If you can do it, tap to accept. You'll then see the full address and can message the customer through the app.",
  },
  {
    step: "5",
    title: "Do the job and update as you go",
    detail:
      "Go check the job if you need to, then send the customer your price. Once they say yes, do the work and tap to mark each step — on the way, arrived, started, done.",
  },
  {
    step: "6",
    title: "Get paid and collect your rating",
    detail:
      "You get paid through the platform after the job is finished. The customer leaves you a star rating. The more good ratings you have, the more work comes your way.",
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
          The full picture
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          How Plug-A-Pro works
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg">
          Two flows. One platform. From a WhatsApp message to a completed job — safely and simply.
        </p>
      </div>

      <div className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <FlowSection
            label="Customer flow"
            title="Request help — from job description to done"
            steps={CUSTOMER_STEPS}
          />
          <FlowSection
            label="Your worker journey"
            title="Sign up. Get jobs. Grow your business."
            steps={WORKER_STEPS}
          />

          <div className="rounded-2xl border border-border/40 p-6 bg-muted/30 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground mb-2">
              Your number stays private
            </p>
            <p>
              Neither party&apos;s personal WhatsApp number is shared by default. All communication goes through the Plug-A-Pro platform — the customer&apos;s address is only revealed to the worker in stages, as the job progresses through acceptance and confirmation.
            </p>
          </div>
        </div>
      </div>

      <CTAStrip />
    </>
  );
}
