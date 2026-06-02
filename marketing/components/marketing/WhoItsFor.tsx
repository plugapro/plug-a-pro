"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";
import { buildWhatsAppLink, whatsappAudienceOptions } from "@/lib/whatsapp";
import { providerPageContent } from "@/content/marketing/provider";
import { serviceScopeMatrix } from "@/content/services/service-scope";
import { providerEconomicsContent } from "@/content/marketing/provider-economics";

export function WhoItsFor() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto space-y-16">

        {/* For Customers */}
        <div>
          <div className="mb-10">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              For customers
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              Any small home job, sorted
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Whether you need a tap checked, a room painted or help with a home maintenance task, Plug A Pro helps you start with the right small-job scope.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {serviceScopeMatrix.slice(0, 8).map((service) => {
              const Icon = service.icon;
              return (
                <div
                  key={service.slug}
                  className="rounded-2xl border border-border/40 p-5 space-y-3 hover:shadow-sm transition-shadow"
                >
                  <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                    <Icon
                      className="size-5"
                      style={{ color: "var(--accent-brand)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="font-semibold text-sm">{service.shortName}</h3>
                  <p className="text-xs text-muted-foreground">{service.headline}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border/40" />

        {/* For Service Providers */}
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              For service providers
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              {providerPageContent.title}
            </h2>
            <p className="text-muted-foreground mb-6">
              {providerPageContent.intro}
            </p>
            <ul className="space-y-2">
              {providerPageContent.serviceTypes.slice(0, 7).map((type) => (
                <li key={type} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span
                    className="size-1.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                  {type}
                </li>
              ))}
            </ul>
        </div>
        <div className="rounded-2xl border border-border/40 p-8 space-y-4 bg-muted/30">
          <p className="font-semibold text-lg">What you get as a service provider</p>
            {providerEconomicsContent.points.map((benefit) => (
              <div key={benefit.title} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span
                  className="mt-1 size-1.5 rounded-full flex-shrink-0"
                  style={{ background: "var(--accent-green-wa)" }}
                  aria-hidden="true"
                />
                <span>
                  <strong className="text-foreground">{benefit.title}:</strong> {benefit.body}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border/40 pt-12">
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
              Start on WhatsApp
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              Pick your path and start the conversation
            </h2>
            <p className="text-muted-foreground">
              Whether you need help at home, want more work or want to join as a provider or partner, the first step is the same: message us on WhatsApp.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {whatsappAudienceOptions.map((option) => (
              <div
                key={option.audience}
                className="rounded-2xl border border-border/40 p-6 bg-muted/20 space-y-4"
              >
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">{option.label}</h3>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                </div>
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      href={buildWhatsAppLink(option.message)}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                  variant={option.audience === "customer" ? "default" : "outline"}
                  className="w-full"
                  onClick={() => {
                    analytics.whatsappClick(`who_its_for_${option.audience}`);
                    analytics.ctaClick(option.label, "who_its_for", option.audience);
                  }}
                >
                  {option.label}
                </Button>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
