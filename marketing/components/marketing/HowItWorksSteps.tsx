import Link from "next/link";
import { homepageHowItWorks } from "@/content/marketing/homepage";

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
          {homepageHowItWorks.map((step) => (
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
