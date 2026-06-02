import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import {
  howItWorksPageContent,
  type FlowStep,
} from "@/content/marketing/how-it-works";

export const metadata: Metadata = buildMetadata(howItWorksPageContent.metadata);

function FlowSection({
  label,
  title,
  steps,
}: {
  label: string;
  title: string;
  steps: readonly FlowStep[];
}) {
  return (
    <div className="mb-16">
      <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <h2 className="mb-8 text-2xl font-bold md:text-3xl">{title}</h2>
      <div className="space-y-0">
        {steps.map((s, i) => (
          <div key={s.step} className="flex gap-5">
            <div className="flex flex-col items-center">
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{
                  background:
                    "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-purple) 50%, var(--accent-brand) 100%)",
                }}
              >
                {s.step}
              </div>
              {i < steps.length - 1 && (
                <div className="my-1 w-px flex-1 bg-border/60" />
              )}
            </div>
            <div className="pb-8">
              <h3 className="mb-1 font-semibold">{s.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
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
      <div className="border-b border-border/40 px-4 py-16 text-center md:py-20">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {howItWorksPageContent.hero.eyebrow}
        </p>
        <h1 className="mb-4 text-4xl font-bold md:text-5xl">
          {howItWorksPageContent.hero.title}
        </h1>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground">
          {howItWorksPageContent.hero.intro}
        </p>
      </div>

      <div className="px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 rounded-2xl border border-border/40 bg-muted/30 p-6 md:p-8">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {howItWorksPageContent.shortVersion.eyebrow}
            </p>
            <div className="grid gap-4 md:grid-cols-4">
              {howItWorksPageContent.shortVersion.items.map((item, index) => (
                <div
                  key={item}
                  className="rounded-xl border border-border/40 bg-background/60 p-4"
                >
                  <p className="mb-2 text-xs text-muted-foreground">
                    {howItWorksPageContent.shortVersion.stepLabelPrefix} {index + 1}
                  </p>
                  <p className="text-sm font-medium">{item}</p>
                </div>
              ))}
            </div>
          </div>

          {howItWorksPageContent.sections.map((section) => (
            <FlowSection
              key={section.label}
              label={section.label}
              title={section.title}
              steps={section.steps}
            />
          ))}

          <div className="mb-16">
            <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {howItWorksPageContent.decisionGates.eyebrow}
            </p>
            <h2 className="mb-8 text-2xl font-bold md:text-3xl">
              {howItWorksPageContent.decisionGates.title}
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {howItWorksPageContent.decisionGates.items.map((gate) => (
                <div
                  key={gate.title}
                  className="rounded-2xl border border-border/40 bg-muted/20 p-6"
                >
                  <h3 className="mb-2 font-semibold">{gate.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {gate.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-muted/30 p-6 text-sm text-muted-foreground">
            <p className="mb-2 font-semibold text-foreground">
              {howItWorksPageContent.releaseNote.title}
            </p>
            <p>{howItWorksPageContent.releaseNote.body}</p>
          </div>
        </div>
      </div>

      <CTAStrip />
    </>
  );
}
