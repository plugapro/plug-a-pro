"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";
import { buildWhatsAppLink, whatsappMessages } from "@/lib/whatsapp";

const providerStoryImages = [
  {
    src: "/images/provider-story/ceiling-drywall-painting.png",
    alt: "Handmade roadside sign advertising ceiling, drywall and painting services near a building material shop",
    label: "Ceiling, drywall and painting",
  },
  {
    src: "/images/provider-story/handyman-painting-tiling.jpg",
    alt: "Handmade roadside sign advertising handyman, painter and tiler services near a building material shop",
    label: "Handyman, painting and tiling",
  },
  {
    src: "/images/provider-story/roofing-waterproofing-gutters.jpg",
    alt: "Handmade roadside sign advertising roofing, waterproofing and gutter services near a building material shop",
    label: "Roofing, waterproofing and gutters",
  },
  {
    src: "/images/provider-story/welding-gates-burglar-bars.jpg",
    alt: "Handmade roadside sign advertising welding, gate motor and burglar bar services near a building material shop",
    label: "Welding, gates and burglar bars",
  },
  {
    src: "/images/provider-story/paving-tiling-renovations.jpg",
    alt: "Handmade roadside sign advertising paving, tiling and renovation services near a building material shop",
    label: "Paving, tiling and renovations",
  },
];

const journeySteps = [
  "A provider advertises their skill",
  "Plug A Pro brings the service online",
  "Customers request help digitally",
  "Local providers become easier to find",
];

export function ProviderStorySection() {
  return (
    <section className="border-t border-border/40 bg-muted/30 px-4 py-20 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-14">

          {/* ── Text column ── */}
          <div>
            <p className="mb-4 text-xs font-medium uppercase tracking-widest brand-gradient-text">
              Built for local service providers
            </p>
            <h2 className="mb-5 text-3xl font-bold leading-tight md:text-4xl">
              From street signs to digital leads
            </h2>
            <div className="space-y-3 text-muted-foreground leading-relaxed text-sm">
              <p>
                Across our communities, skilled plumbers, carpenters,
                painters, tilers, welders, roofers and handymen are already putting
                themselves out there. Many still rely on handmade roadside signs,
                referrals and passing traffic to find work.
              </p>
              <p>
                Plug A Pro brings that local skill into a digital marketplace where
                customers can find help faster and service providers become easier
                to discover.
              </p>
            </div>

            <div className="mt-6 space-y-2 text-sm text-muted-foreground">
              {[
                "Customers can request help without driving around looking for signs.",
                "Providers get a better digital presence for their trade.",
                "Local skills become visible, searchable and easier to book.",
              ].map((point) => (
                <div key={point} className="flex gap-3">
                  <span
                    className="mt-[7px] size-1.5 shrink-0 rounded-full"
                    style={{ background: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                  <span>{point}</span>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                nativeButton={false}
                render={
                  <Link
                    href={buildWhatsAppLink(whatsappMessages.customer)}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                size="default"
                onClick={() => {
                  analytics.whatsappClick("provider_story_customer");
                  analytics.ctaClick("Find a Local Pro", "provider_story", "customer");
                }}
              >
                Find a Local Pro
              </Button>
              <Button
                nativeButton={false}
                render={
                  <Link
                    href={buildWhatsAppLink(whatsappMessages.provider)}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                variant="outline"
                size="default"
                onClick={() => {
                  analytics.whatsappClick("provider_story_provider");
                  analytics.ctaClick("Register as a Provider", "provider_story", "provider");
                }}
              >
                Register as a Provider
              </Button>
            </div>
          </div>

          {/* ── Image column ── */}
          {/* Mobile: horizontal scroll; desktop: clean 2×2 grid */}
          <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:overflow-visible md:px-0 md:pb-0">
            <div className="flex min-w-max gap-3 snap-x md:grid md:min-w-0 md:grid-cols-2 md:gap-3">
              {providerStoryImages.slice(0, 4).map((image) => (
                <figure
                  key={image.src}
                  className="group relative w-[72vw] max-w-[300px] shrink-0 snap-center overflow-hidden rounded-xl border border-border/50 bg-background shadow-sm transition-shadow hover:shadow-md md:w-auto md:max-w-none"
                >
                  <div className="aspect-[4/3]">
                    <Image
                      src={image.src}
                      alt={image.alt}
                      width={800}
                      height={600}
                      sizes="(min-width: 1024px) 22rem, 72vw"
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
                    />
                  </div>
                  <figcaption className="absolute inset-x-3 bottom-3 rounded-lg border border-white/20 bg-black/55 px-3 py-1.5 text-xs font-medium text-white shadow-sm backdrop-blur-sm">
                    {image.label}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>

        {/* ── Journey steps ── */}
        <div className="mt-10 grid gap-2 sm:grid-cols-2 md:grid-cols-4">
          {journeySteps.map((step, index) => (
            <div
              key={step}
              className="rounded-xl border border-border/40 bg-background/80 px-4 py-3"
            >
              <p className="mb-1 text-xs font-semibold text-muted-foreground">
                Step {index + 1}
              </p>
              <p className="text-sm font-medium">{step}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
