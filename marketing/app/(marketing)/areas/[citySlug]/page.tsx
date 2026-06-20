import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ServiceScopeCard } from "@/components/services/ServiceScopeCard";
import {
  PILOT_AREAS,
  PILOT_AREA_SLUGS,
  getAreaBySlug,
} from "@/content/areas/area-content";
import { serviceScopeMatrix } from "@/content/services/service-scope";
import { breadcrumbLd, jsonLdScript, localBusinessLd } from "@/lib/jsonld";
import { buildMetadata, siteConfig } from "@/lib/metadata";

type AreaPageProps = {
  params: Promise<{ citySlug: string }>;
};

export function generateStaticParams() {
  return PILOT_AREA_SLUGS.map((citySlug) => ({ citySlug }));
}

export async function generateMetadata({ params }: AreaPageProps): Promise<Metadata> {
  const { citySlug } = await params;
  const area = getAreaBySlug(citySlug);

  if (!area) {
    return buildMetadata({
      title: "Service area",
      description: siteConfig.description,
      noIndex: true,
    });
  }

  return buildMetadata({
    title: `${area.name} Services`,
    description: area.intro,
    canonical: `/areas/${area.slug}`,
  });
}

export default async function AreaPage({ params }: AreaPageProps) {
  const { citySlug } = await params;
  const area = getAreaBySlug(citySlug);

  if (!area) notFound();

  const bookableServices = serviceScopeMatrix.filter(
    (service) => service.ctaMode === "REQUEST",
  );

  const otherAreas = PILOT_AREAS.filter((other) => other.slug !== area.slug);

  const breadcrumb = breadcrumbLd([
    { name: "Home", url: siteConfig.url },
    { name: "Areas", url: `${siteConfig.url}/areas` },
    { name: area.name, url: `${siteConfig.url}/areas/${area.slug}` },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(localBusinessLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <div className="border-b border-border/40 px-4 py-16 text-center md:py-20">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {area.province}
        </p>
        <h1 className="mx-auto mb-4 max-w-3xl text-4xl font-bold md:text-5xl">
          {area.name} local services
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          {area.intro}
        </p>
      </div>

      <section className="px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-6 text-2xl font-bold">
            Small jobs available in {area.name}
          </h2>
          <div className="grid gap-6">
            {bookableServices.map((service) => (
              <div key={service.slug}>
                <ServiceScopeCard service={service} />
                <div className="mt-3">
                  <Button
                    nativeButton={false}
                    render={
                      <Link href={`/areas/${area.slug}/${service.slug}`} />
                    }
                    variant="outline"
                    size="sm"
                  >
                    See {service.shortName} in {area.name}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border/40 px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-4 text-2xl font-bold">Suburbs we cover in {area.name}</h2>
          <p className="mb-5 text-sm leading-6 text-muted-foreground">
            Plug A Pro can route requests across the wider {area.name} metro,
            including these suburbs and the areas around them.
          </p>
          <ul className="flex flex-wrap gap-2">
            {area.suburbs.map((suburb) => (
              <li
                key={suburb}
                className="rounded-full border border-border/50 bg-background/70 px-3 py-1 text-sm text-muted-foreground"
              >
                {suburb}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {otherAreas.length > 0 ? (
        <section className="border-t border-border/40 px-4 py-12">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-4 text-2xl font-bold">Other areas we serve</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {otherAreas.map((other) => (
                <li key={other.slug}>
                  <Button
                    nativeButton={false}
                    render={<Link href={`/areas/${other.slug}`} />}
                    variant="outline"
                    size="sm"
                  >
                    {other.name} services
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
