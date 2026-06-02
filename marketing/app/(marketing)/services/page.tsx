import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import {
  getServicesByStatus,
  serviceScopePageContent,
  serviceScopeLabels,
  serviceScopeMatrix,
  type ServiceScopeStatus,
} from "@/content/services/service-scope";
import { ServiceScopeCard } from "@/components/services/ServiceScopeCard";
import { Button } from "@/components/ui/button";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import { WhatsAppCtaButton } from "@/components/marketing/WhatsAppCtaButton";

export const metadata: Metadata = buildMetadata(serviceScopePageContent.metadata);

const statuses: ServiceScopeStatus[] = ["GREEN", "AMBER", "RED"];

export default function ServicesPage() {
  return (
    <>
      <div className="border-b border-border/40 px-4 py-16 text-center md:py-20">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {serviceScopePageContent.eyebrow}
        </p>
        <h1 className="mx-auto mb-4 max-w-3xl text-4xl font-bold md:text-5xl">
          {serviceScopePageContent.title}
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          {serviceScopePageContent.intro}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <WhatsAppCtaButton
            audience="customer"
            label={serviceScopePageContent.primaryCtaLabel}
            source="services_header"
            size="lg"
          />
          <Button nativeButton={false} render={<Link href="/trust" />} variant="outline" size="lg">
            {serviceScopePageContent.secondaryCtaLabel}
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
          <h2 className="mb-3 text-2xl font-bold">
            {serviceScopePageContent.uncertainty.title}
          </h2>
          <p className="mb-5 text-sm leading-6 text-muted-foreground">
            {serviceScopePageContent.uncertainty.body}
          </p>
          <WhatsAppCtaButton
            audience="customer"
            label={serviceScopePageContent.uncertainty.ctaLabel}
            source="services_uncertain"
            size="sm"
          />
        </div>
      </section>

      <CTAStrip />
    </>
  );
}
