import Link from "next/link";

const STEPS = [
  {
    number: "01",
    title: "Customer sends the request",
    description:
      "Start on WhatsApp or the PWA. Tell Plug A Pro what needs doing, where the job is, when you prefer the work to happen, and add photos if helpful.",
    detail: "A structured request is created for operations review and matching.",
  },
  {
    number: "02",
    title: "Ops reviews and matches",
    description:
      "The request enters the dispatch queue. Plug A Pro checks the job details and routes it to approved providers whose skills, areas, and availability fit.",
    detail: "Pending, rejected, inactive, or suspended providers are not part of live matching.",
  },
  {
    number: "03",
    title: "Provider unlocks before accepting",
    description:
      "The provider receives a WhatsApp lead preview, opens a secure job link, and unlocks the lead with credits before full customer details are released.",
    detail: "If there are not enough credits, the provider must top up before accepting.",
  },
  {
    number: "04",
    title: "Handover, quote, and job updates",
    description:
      "After acceptance, both sides get the right handover details. The provider can contact the customer, submit a quote, update job status, and request approval for extra work when needed.",
    detail: "Customers receive WhatsApp updates as the job moves forward.",
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
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
