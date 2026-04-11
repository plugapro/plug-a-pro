import Link from "next/link";

const STEPS = [
  {
    number: "01",
    title: "Describe your job",
    description:
      "Send a message on WhatsApp or use the app. Tell us what needs doing, where you are, and share a photo if helpful. Takes under 3 minutes.",
    detail: "Works on any phone with WhatsApp. No app download needed.",
  },
  {
    number: "02",
    title: "Get matched to a nearby worker",
    description:
      "We find available workers near you whose profile matches that type of job. A lead is sent to matching workers. The first to accept, or the one you choose, takes the job.",
    detail: "Your personal number is not shared at this stage.",
  },
  {
    number: "03",
    title: "Agree on price, book, done",
    description:
      "The worker visits to inspect if needed, or sends a quote directly. You approve before any work starts. Payment follows the written quote and booking flow used for that job.",
    detail: "Extra work requires your explicit approval before it begins.",
  },
];

export function HowItWorksSteps() {
  return (
    <section
      className="py-20 md:py-24 px-4 border-t border-border/40 bg-muted/50"
    >
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest mb-3 brand-gradient-text">
            How it works
          </p>
          <h2 className="text-3xl md:text-4xl font-bold">
            From job to done, in a few taps
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {STEPS.map((step) => (
            <div key={step.number} className="relative">
              <div
                className="text-5xl font-bold mb-4 bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-purple) 50%, var(--accent-brand) 100%)",
                }}
                aria-hidden="true"
              >
                {step.number}
              </div>
              <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                {step.description}
              </p>
              <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">
                {step.detail}
              </p>
            </div>
          ))}
        </div>
        <div className="text-center mt-10">
          <Link
            href="/how-it-works"
            className="text-sm font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--accent-brand)" }}
          >
            See the full flow in detail →
          </Link>
        </div>
      </div>
    </section>
  );
}
