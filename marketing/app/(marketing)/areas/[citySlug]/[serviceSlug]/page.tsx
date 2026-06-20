import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  PILOT_AREAS,
  getAreaBySlug,
  getAreaServiceLandingPairs,
} from "@/content/areas/area-content";
import {
  getServiceScopeBySlug,
  serviceScopeMatrix,
} from "@/content/services/service-scope";
import { breadcrumbLd, jsonLdScript, serviceLd } from "@/lib/jsonld";
import { buildMetadata, siteConfig } from "@/lib/metadata";
import { buildWhatsAppLink } from "@/lib/whatsapp";

type AreaServicePageProps = {
  params: Promise<{ citySlug: string; serviceSlug: string }>;
};

export function generateStaticParams() {
  return getAreaServiceLandingPairs().map(({ citySlug, serviceSlug }) => ({
    citySlug,
    serviceSlug,
  }));
}

export async function generateMetadata({
  params,
}: AreaServicePageProps): Promise<Metadata> {
  const { citySlug, serviceSlug } = await params;
  const area = getAreaBySlug(citySlug);
  const service = serviceScopeMatrix.find((item) => item.slug === serviceSlug);

  if (!area || !service) {
    return buildMetadata({
      title: "Service area",
      description: siteConfig.description,
      noIndex: true,
    });
  }

  return buildMetadata({
    title: `${service.name} in ${area.name}`,
    description: `${service.customerDescription} Plug A Pro routes ${service.shortName.toLowerCase()} requests across ${area.name}.`,
    canonical: `/areas/${area.slug}/${service.slug}`,
  });
}

export default async function AreaServicePage({ params }: AreaServicePageProps) {
  const { citySlug, serviceSlug } = await params;
  const area = getAreaBySlug(citySlug);
  const service = serviceScopeMatrix.find((item) => item.slug === serviceSlug);

  if (!area || !service) notFound();

  const resolvedService = getServiceScopeBySlug(service.slug);

  const whatsappMessage = `Hi! I need a ${service.shortName.toLowerCase()} in ${area.name}.`;
  const whatsappHref = buildWhatsAppLink(whatsappMessage);

  const breadcrumb = breadcrumbLd([
    { name: "Home", url: siteConfig.url },
    { name: "Areas", url: `${siteConfig.url}/areas` },
    { name: area.name, url: `${siteConfig.url}/areas/${area.slug}` },
    {
      name: service.name,
      url: `${siteConfig.url}/areas/${area.slug}/${service.slug}`,
    },
  ]);

  const servicePayload = serviceLd({
    name: service.name,
    description: service.customerDescription,
    slug: service.slug,
  });

  const otherAreasSameService = PILOT_AREAS.filter(
    (other) => other.slug !== area.slug,
  ).slice(0, 2);

  const otherServicesSameArea = serviceScopeMatrix
    .filter(
      (other) => other.ctaMode === "REQUEST" && other.slug !== service.slug,
    )
    .slice(0, 2);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(servicePayload) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <div className="border-b border-border/40 px-4 py-16 text-center md:py-20">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {area.name} · {area.province}
        </p>
        <h1 className="mx-auto mb-4 max-w-3xl text-4xl font-bold md:text-5xl">
          {resolvedService.name} in {area.name}
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          {resolvedService.customerDescription} Plug A Pro routes {resolvedService.shortName.toLowerCase()} requests across {area.name}.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Button
            nativeButton={false}
            render={
              <Link href={whatsappHref} target="_blank" rel="noopener noreferrer" />
            }
            size="lg"
          >
            Start on WhatsApp
          </Button>
          <Button
            nativeButton={false}
            render={<Link href={`/services/${resolvedService.slug}`} />}
            variant="outline"
            size="lg"
          >
            View full scope
          </Button>
        </div>
      </div>

      <section className="px-4 py-12">
        <div className="mx-auto grid max-w-4xl gap-8 sm:grid-cols-2">
          <div>
            <h2 className="mb-3 text-xl font-bold">Examples</h2>
            <ul className="space-y-2">
              {resolvedService.examples.map((example) => (
                <li key={example} className="flex gap-2 text-sm text-muted-foreground">
                  <span
                    className="mt-2 size-1.5 shrink-0 rounded-full"
                    style={{ background: "var(--accent-green-wa)" }}
                    aria-hidden="true"
                  />
                  {example}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-3 text-xl font-bold">Not in this scope</h2>
            <ul className="space-y-2">
              {resolvedService.exclusions.map((exclusion) => (
                <li key={exclusion} className="flex gap-2 text-sm text-muted-foreground">
                  <span
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/45"
                    aria-hidden="true"
                  />
                  {exclusion}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {otherAreasSameService.length > 0 ? (
        <section className="border-t border-border/40 px-4 py-12">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-4 text-2xl font-bold">
              {resolvedService.name} in other areas
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {otherAreasSameService.map((other) => (
                <li key={other.slug}>
                  <Button
                    nativeButton={false}
                    render={
                      <Link href={`/areas/${other.slug}/${resolvedService.slug}`} />
                    }
                    variant="outline"
                    size="sm"
                  >
                    {resolvedService.shortName} in {other.name}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {otherServicesSameArea.length > 0 ? (
        <section className="border-t border-border/40 px-4 py-12">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-4 text-2xl font-bold">
              Other small jobs in {area.name}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {otherServicesSameArea.map((other) => (
                <li key={other.slug}>
                  <Button
                    nativeButton={false}
                    render={
                      <Link href={`/areas/${area.slug}/${other.slug}`} />
                    }
                    variant="outline"
                    size="sm"
                  >
                    {other.shortName} in {area.name}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </>
  );
}
