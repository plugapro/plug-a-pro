import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { providerPageContent } from "@/content/marketing/provider";
import { providerEconomicsContent } from "@/content/marketing/provider-economics";
import { reviewModelContent } from "@/content/marketing/reviews";
import { Button } from "@/components/ui/button";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import { WhatsAppCtaButton } from "@/components/marketing/WhatsAppCtaButton";
import { whatsappNumberDisplay } from "@/lib/whatsapp";

export const metadata: Metadata = buildMetadata(providerPageContent.metadata);

export default function ForProvidersPage() {
  return (
    <>
      <div className="border-b border-border/40 px-4 py-16 text-center md:py-20">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {providerPageContent.eyebrow}
        </p>
        <h1 className="mx-auto mb-4 max-w-3xl text-4xl font-bold md:text-5xl">
          {providerPageContent.title}
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
          {providerPageContent.intro}
        </p>
        <p className="mb-8 text-sm font-medium">
          {providerPageContent.whatsappStartPrefix} {whatsappNumberDisplay}
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <WhatsAppCtaButton
            audience="provider"
            label={providerPageContent.primaryCtaLabel}
            source="for_providers_header"
            size="lg"
          />
          <Button
            nativeButton={false}
            render={<Link href="/services" />}
            variant="outline"
            size="lg"
          >
            {providerPageContent.secondaryCtaLabel}
          </Button>
        </div>
      </div>

      <section className="px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-3xl font-bold">
            {providerPageContent.benefitsHeading}
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            {providerPageContent.benefits.map((benefit) => {
              const Icon = benefit.icon;

              return (
                <div
                  key={benefit.title}
                  className="flex gap-5 rounded-2xl border border-border/40 p-6"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <Icon
                      className="size-5"
                      style={{ color: "var(--accent-brand)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <h3 className="mb-1 font-semibold">{benefit.title}</h3>
                    <p className="text-sm text-muted-foreground">{benefit.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-border/40 px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-12 text-center text-3xl font-bold">
            {providerPageContent.joinHeading}
          </h2>
          <div>
            {providerPageContent.joinSteps.map((step, index) => (
              <div key={step.step} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full brand-gradient-bg text-xs font-bold text-white">
                    {step.step}
                  </div>
                  {index < providerPageContent.joinSteps.length - 1 ? (
                    <div className="my-1 w-px flex-1 bg-border/60" />
                  ) : null}
                </div>
                <div className="pb-8">
                  <h3 className="mb-1 font-semibold">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {step.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border/40 px-4 py-16">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border/40 bg-muted/30 p-8">
            <h2 className="mb-3 text-2xl font-bold">{providerEconomicsContent.title}</h2>
            <p className="mb-6 text-sm leading-6 text-muted-foreground">
              {providerEconomicsContent.intro}
            </p>
            <div className="space-y-4">
              {providerEconomicsContent.points.map((point) => (
                <div key={point.title}>
                  <h3 className="text-sm font-semibold">{point.title}</h3>
                  <p className="text-sm text-muted-foreground">{point.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 p-8">
            <h2 className="mb-3 text-2xl font-bold">{reviewModelContent.title}</h2>
            <p className="mb-6 text-sm leading-6 text-muted-foreground">
              {reviewModelContent.intro}
            </p>
            <div className="space-y-3">
              {reviewModelContent.dimensions.map((dimension) => (
                <div key={dimension.key} className="rounded-xl border border-border/40 p-4">
                  <h3 className="text-sm font-semibold">{dimension.label}</h3>
                  <p className="text-sm text-muted-foreground">{dimension.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border/40 px-4 py-16">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border/40 bg-muted/30 p-8">
          <h2 className="mb-4 text-xl font-bold">{providerPageContent.eligibility.title}</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {providerPageContent.eligibility.body}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {providerPageContent.serviceTypes.map((type) => (
              <li key={type} className="flex items-center gap-2 text-sm text-muted-foreground">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--accent-green-wa)" }}
                  aria-hidden="true"
                />
                {type}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <WhatsAppCtaButton
              audience="provider"
              label={providerPageContent.eligibility.ctaLabel}
              source="for_providers_join"
              size="sm"
            />
          </div>
        </div>
      </section>

      <CTAStrip />
    </>
  );
}
