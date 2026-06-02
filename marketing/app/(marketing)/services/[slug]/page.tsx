import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/metadata";
import { Button } from "@/components/ui/button";
import { ServiceScopeCard } from "@/components/services/ServiceScopeCard";
import {
  serviceScopeMatrix,
  getServiceScopeBySlug,
  serviceScopePageContent,
} from "@/content/services/service-scope";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { buildWhatsAppServiceMessage } from "@/lib/services/scopeRules";

type ServicePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return serviceScopeMatrix.map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({ params }: ServicePageProps): Promise<Metadata> {
  const { slug } = await params;
  const service = serviceScopeMatrix.find((item) => item.slug === slug);

  if (!service) {
    return buildMetadata({
      title: serviceScopePageContent.detail.fallbackTitle,
      description: serviceScopePageContent.detail.fallbackDescription,
      noIndex: true,
    });
  }

  return buildMetadata({
    title: `${service.name} Scope`,
    description: service.customerDescription,
  });
}

export default async function ServiceDetailPage({ params }: ServicePageProps) {
  const { slug } = await params;
  const service = serviceScopeMatrix.find((item) => item.slug === slug);

  if (!service) notFound();

  const resolvedService = getServiceScopeBySlug(slug);

  return (
    <main className="px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <Button nativeButton={false} render={<Link href="/services" />} variant="outline" size="sm">
          {serviceScopePageContent.detail.backLabel}
        </Button>
        <div className="mt-6">
          <ServiceScopeCard service={resolvedService} />
        </div>

        <section className="mt-8 rounded-2xl border border-border/40 bg-muted/30 p-8">
          <h2 className="mb-3 text-2xl font-bold">
            {serviceScopePageContent.detail.startTitle}
          </h2>
          <p className="mb-5 text-sm leading-6 text-muted-foreground">
            {serviceScopePageContent.detail.startBody}
          </p>
          {resolvedService.ctaMode === "NOT_SUPPORTED" ? (
            <Button nativeButton={false} render={<Link href="/services" />} variant="outline" size="sm">
              {serviceScopePageContent.detail.unsupportedCtaLabel}
            </Button>
          ) : (
            <Button
              nativeButton={false}
              render={
                <Link
                  href={buildWhatsAppLink(buildWhatsAppServiceMessage(resolvedService))}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              size="sm"
            >
              {serviceScopePageContent.detail.supportedCtaLabel}
            </Button>
          )}
        </section>
      </div>
    </main>
  );
}
