import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import {
  getServicesByStatus,
  serviceScopeLabels,
  serviceScopeMatrix,
  type ServiceScopeStatus,
} from "@/content/services/service-scope";
import { ServiceScopeCard } from "@/components/services/ServiceScopeCard";
import { Button } from "@/components/ui/button";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import { WhatsAppCtaButton } from "@/components/marketing/WhatsAppCtaButton";

export const metadata: Metadata = buildMetadata({
  title: "MVP Service Scope",
  description:
    "See which small everyday jobs Plug A Pro supports during the WhatsApp-first MVP launch.",
});

const statuses: ServiceScopeStatus[] = ["GREEN", "AMBER", "RED"];

export default function ServicesPage() {
  return (
    <>
      <div className="border-b border-border/40 px-4 py-16 text-center md:py-20">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          MVP service scope
        </p>
        <h1 className="mx-auto mb-4 max-w-3xl text-4xl font-bold md:text-5xl">
          Small everyday jobs only.
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Plug A Pro launches with simple, defined home jobs that can be described on WhatsApp, quoted in writing and documented in the job record.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <WhatsAppCtaButton
            audience="customer"
            label="Start on WhatsApp"
            source="services_header"
            size="lg"
          />
          <Button nativeButton={false} render={<Link href="/trust" />} variant="outline" size="lg">
            View trust process
          </Button>
        </div>
      </div>

      <section className="px-4 py-10">
        <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-3">
          {statuses.map((status) => {
            const label = serviceScopeLabels[status];

            return (
              <div key={status} className={`rounded-2xl border p-5 ${label.toneClass}`}>
                <p className="text-sm font-semibold">{label.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{label.summary}</p>
                <p className="mt-3 text-2xl font-bold">{getServicesByStatus(status).length}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="px-4 pb-16">
        <div className="mx-auto grid max-w-5xl gap-6">
          {serviceScopeMatrix.map((service) => (
            <ServiceScopeCard key={service.slug} service={service} />
          ))}
        </div>
      </section>

      <section className="border-t border-border/40 px-4 py-12">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mb-3 text-2xl font-bold">Not sure where your job fits?</h2>
          <p className="mb-5 text-sm leading-6 text-muted-foreground">
            Send the job on WhatsApp and support will help classify the scope before any provider is matched.
          </p>
          <WhatsAppCtaButton
            audience="customer"
            label="Ask on WhatsApp"
            source="services_uncertain"
            size="sm"
          />
        </div>
      </section>

      <CTAStrip />
    </>
  );
}
