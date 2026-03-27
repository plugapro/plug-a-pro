import Link from "next/link";

const STEPS = [
  {
    number: "01",
    title: "Customer books via WhatsApp",
    description:
      "Your customer sends \u201cHi\u201d to your Plug-A-Pro number. A guided menu walks them through service, address, and time slot \u2014 under 3 minutes. No app. No email.",
    detail: "Works on any Android with WhatsApp. No account needed.",
  },
  {
    number: "02",
    title: "You dispatch the right technician",
    description:
      "New bookings appear in your admin console. Assign a technician in one tap. They receive a WhatsApp notification instantly with all job details.",
    detail: "Real-time status updates from assignment through completion.",
  },
  {
    number: "03",
    title: "Technician completes the job on-site",
    description:
      "Your technician updates job status from the lightweight PWA on their phone \u2014 arrived, started, completed. Before and after photos uploaded automatically.",
    detail: "Invoice auto-generated on completion. Sent to customer via WhatsApp.",
  },
];

export function HowItWorksSteps() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            How it works
          </p>
          <h2 className="text-3xl md:text-4xl font-bold">
            End-to-end in three steps
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {STEPS.map((step) => (
            <div key={step.number} className="relative">
              <div
                className="text-5xl font-bold mb-4 bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-brand) 100%)",
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
