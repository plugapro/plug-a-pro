import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ServiceScopeItem } from "@/content/services/service-scope";
import { serviceScopeCtaLabels, serviceScopeLabels } from "@/content/services/service-scope";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { buildWhatsAppServiceMessage } from "@/lib/services/scopeRules";

export function ServiceScopeCard({ service }: { service: ServiceScopeItem }) {
  const Icon = service.icon;
  const scope = serviceScopeLabels[service.status];
  const primaryLabel = serviceScopeCtaLabels[service.ctaMode];

  return (
    <article className={`rounded-2xl border p-6 ${scope.toneClass}`}>
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background/80">
          <Icon className="size-5" style={{ color: "var(--accent-brand)" }} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border/50 bg-background/70 px-2.5 py-1 text-xs font-medium">
              {scope.label}
            </span>
            <span className="text-xs text-muted-foreground">{scope.summary}</span>
          </div>
          <h2 className="text-xl font-bold">{service.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{service.headline}</p>
        </div>
      </div>

      <p className="mt-5 text-sm leading-6 text-muted-foreground">
        {service.customerDescription}
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Examples</h3>
          <ul className="space-y-2">
            {service.examples.slice(0, 4).map((example) => (
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
          <h3 className="mb-2 text-sm font-semibold">Not in this scope</h3>
          <ul className="space-y-2">
            {service.exclusions.slice(0, 3).map((exclusion) => (
              <li key={exclusion} className="flex gap-2 text-sm text-muted-foreground">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/45" aria-hidden="true" />
                {exclusion}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {service.ctaMode === "NOT_SUPPORTED" ? null : (
          <Button
            nativeButton={false}
            render={
              <Link
                href={buildWhatsAppLink(buildWhatsAppServiceMessage(service))}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            size="sm"
          >
            {primaryLabel}
          </Button>
        )}
        <Button
          nativeButton={false}
          render={<Link href={`/services/${service.slug}`} />}
          variant="outline"
          size="sm"
        >
          {serviceScopeCtaLabels.VIEW_SCOPE}
        </Button>
      </div>
    </article>
  );
}
