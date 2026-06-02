import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { trustPackItems, trustPageContent } from "@/content/marketing/trust";
import { Button } from "@/components/ui/button";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "Trust & Safety",
  description:
    "How Plug A Pro uses reviewed profiles, written quotes, job records, photos, reviews and support escalation for a WhatsApp-first small-job flow.",
});

export default function TrustPage() {
  return (
    <>
      <div className="border-b border-border/40 px-4 py-16 text-center md:py-20">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {trustPageContent.eyebrow}
        </p>
        <h1 className="mx-auto mb-4 max-w-3xl text-4xl font-bold md:text-5xl">
          {trustPageContent.title}
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          {trustPageContent.intro}
        </p>
      </div>

      <section className="border-b border-border/40 px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-3xl font-bold">Trust pack</h2>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {trustPackItems.map((item) => {
              const Icon = item.icon;

              return (
                <div key={item.eventType} className="rounded-2xl border border-border/40 p-6">
                  <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-muted">
                    <Icon
                      className="size-5"
                      style={{ color: "var(--accent-brand)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="mb-2 font-semibold">{item.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-border/40 px-4 py-16">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
          {trustPageContent.process.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.title} className="rounded-2xl border border-border/40 bg-muted/20 p-6">
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-background">
                  <Icon
                    className="size-5"
                    style={{ color: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                </div>
                <h2 className="mb-2 text-lg font-semibold">{item.title}</h2>
                <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="border-b border-border/40 px-4 py-16">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border/40 p-8">
            <h2 className="mb-3 text-2xl font-bold">
              {trustPageContent.providerEconomics.title}
            </h2>
            <p className="mb-6 text-sm leading-6 text-muted-foreground">
              {trustPageContent.providerEconomics.intro}
            </p>
            <div className="space-y-4">
              {trustPageContent.providerEconomics.points.map((point) => (
                <div key={point.title}>
                  <h3 className="text-sm font-semibold">{point.title}</h3>
                  <p className="text-sm text-muted-foreground">{point.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-muted/30 p-8">
            <h2 className="mb-3 text-2xl font-bold">
              {trustPageContent.reviewModel.title}
            </h2>
            <p className="mb-6 text-sm leading-6 text-muted-foreground">
              {trustPageContent.reviewModel.intro}
            </p>
            <div className="space-y-3">
              {trustPageContent.reviewModel.dimensions.map((dimension) => (
                <div key={dimension.key} className="rounded-xl border border-border/40 bg-background p-4">
                  <h3 className="text-sm font-semibold">{dimension.label}</h3>
                  <p className="text-sm text-muted-foreground">{dimension.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-16">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border/40 bg-muted/30 p-8">
          <h2 className="mb-4 text-xl font-bold">What Plug A Pro is not</h2>
          <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
            <li>Plug A Pro does not supply employees or place people into jobs.</li>
            <li>Plug A Pro does not promise pre-set prices or automatic bookings.</li>
            <li>Plug A Pro is not for major builds, remodels or high-risk regulated jobs in the MVP launch.</li>
            <li>{trustPageContent.accountabilityNote}</li>
          </ul>
          <div className="mt-6 border-t border-border/40 pt-6">
            <Button nativeButton={false} render={<Link href="/services" />} variant="outline" size="sm">
              View MVP service scope
            </Button>
          </div>
        </div>
      </section>

      <CTAStrip />
    </>
  );
}
