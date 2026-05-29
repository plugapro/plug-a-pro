import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata, getAppUrl } from "@/lib/metadata";
import { Button } from "@/components/ui/button";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import { whatsappNumberDisplay } from "@/lib/whatsapp";
import { WhatsAppCtaButton } from "@/components/marketing/WhatsAppCtaButton";
import { WebCtaButton } from "@/components/marketing/WebCtaButton";
import {
  MessageCircle,
  MapPin,
  UserCheck,
  FileText,
  Camera,
  Star,
  ShieldCheck,
  Clock,
} from "lucide-react";

export const metadata: Metadata = buildMetadata({
  title: "For Customers",
  description:
    "Get help with any small home job. Plumbing, painting, gardening, handyman work, and more. Message us on WhatsApp and we'll match you to a nearby service provider.",
});

const HOW_IT_WORKS = [
  {
    icon: MessageCircle,
    step: "01",
    title: "Describe your job on WhatsApp",
    detail:
      "Message the Plug A Pro WhatsApp number. Tell us what you need. Plumbing leak, garden overgrown, wall needs painting. We'll ask a few short questions to understand the job.",
  },
  {
    icon: MapPin,
    step: "02",
    title: "We match you to nearby service providers",
    detail:
      "We find available local service providers in your area who have the right skills. Once they accept, we keep the process moving on WhatsApp so you can review the quote before work starts.",
  },
  {
    icon: UserCheck,
    step: "03",
    title: "Confirm and book",
    detail:
      "If a service provider needs to inspect the job first, we arrange a short visit before quoting. For straightforward jobs, they submit a quote directly. You approve before anything is scheduled.",
  },
  {
    icon: FileText,
    step: "04",
    title: "Approve the quote in writing",
    detail:
      "All quotes come through Plug A Pro in writing. You review the price and scope, then approve in writing. No verbal agreements. Everything is written down.",
  },
  {
    icon: Camera,
    step: "05",
    title: "Provider arrives and does the job",
    detail:
      "Your selected service provider arrives at the agreed time. Photos, notes, and status updates can be added to the job record where the workflow supports them. You can follow progress via WhatsApp.",
  },
  {
    icon: Star,
    step: "06",
    title: "Pay and leave a review",
    detail:
      "Once the job is done, Plug A Pro confirms the close-out and you can leave a review to help other customers and reward great service providers. Your review builds trust in the community.",
  },
];

const PROTECTIONS = [
  {
    icon: ShieldCheck,
    title: "Your number stays private",
    body: "We never need to share your personal phone number just to get the job moving. Plug A Pro handles intake, quote approval, and status updates from the platform number.",
  },
  {
    icon: UserCheck,
    title: "Applications reviewed before activation",
    body: "Applications are manually reviewed before activation — an eligibility check for marketplace participation, not a guarantee of licensing, safety, or workmanship. Provider profiles show what each service provider has submitted and recorded on Plug A Pro.",
  },
  {
    icon: FileText,
    title: "Quotes in writing, always",
    body: "Nothing is agreed verbally. Every price and scope is confirmed in writing through the platform before work begins. No surprises.",
  },
  {
    icon: Camera,
    title: "Photo documentation",
    body: "Photos and job notes can be attached to the job record where available. If there is a dispute about the work, the written record gives support a starting point.",
  },
  {
    icon: Clock,
    title: "Platform mediation for disputes",
    body: "If something goes wrong, contact Plug A Pro support. We review the written quote, job history, and photos already attached to the record.",
  },
  {
    icon: Star,
    title: "Public reviews build accountability",
    body: "Every completed job generates a review. Providers who are unreliable tend not to get repeated leads. Providers who do great work build a reputation that earns them more work.",
  },
];

export default function ForCustomersPage() {
  return (
    <>
      {/* Header */}
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          For customers
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Home jobs sorted. On WhatsApp.
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg mb-8">
          Describe what you need. We&apos;ll match you to a nearby service provider, send the quote for approval, and keep the job moving on WhatsApp.
        </p>
        <p className="text-sm font-medium mb-8">
          Start on WhatsApp at {whatsappNumberDisplay}
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <WhatsAppCtaButton
            audience="customer"
            label="Start on WhatsApp"
            source="for_customers_header"
            size="lg"
          />
          <WebCtaButton
            href={`${getAppUrl()}/sign-up`}
            label="Book on the web →"
            source="for_customers_header"
            variant="outline"
            size="lg"
          />
          <Button
            nativeButton={false}
            render={<Link href="/solutions" />}
            variant="outline"
            size="lg"
          >
            See what jobs we cover
          </Button>
        </div>
      </div>

      {/* How it works */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            How it works
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            Here&apos;s what to expect, from your first WhatsApp message to a completed job.
          </p>
          <div className="space-y-0">
            {HOW_IT_WORKS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.step} className="flex gap-5">
                  <div className="flex flex-col items-center">
                    <div
                      className="size-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{
                        background:
                          "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-purple) 50%, var(--accent-brand) 100%)",
                      }}
                    >
                      {s.step}
                    </div>
                    {i < HOW_IT_WORKS.length - 1 && (
                      <div className="w-px flex-1 bg-border/60 my-1" />
                    )}
                  </div>
                  <div className="pb-10 flex gap-4">
                    <div className="size-9 rounded-xl flex items-center justify-center bg-muted flex-shrink-0 mt-0.5">
                      <Icon
                        className="size-4"
                        style={{ color: "var(--accent-brand)" }}
                        aria-hidden="true"
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">{s.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {s.detail}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Protections */}
      <section className="py-16 px-4 border-t border-border/40">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            How we protect you
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            Letting a stranger into your home takes trust. Here&apos;s how Plug A Pro builds it.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {PROTECTIONS.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.title}
                  className="rounded-2xl border border-border/40 p-6"
                >
                  <div className="size-10 rounded-xl flex items-center justify-center bg-muted mb-4">
                    <Icon
                      className="size-5"
                      style={{ color: "var(--accent-brand)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="font-semibold mb-2">{p.title}</h3>
                  <p className="text-sm text-muted-foreground">{p.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Jobs we cover */}
      <section className="py-16 px-4 border-t border-border/40">
        <div className="max-w-3xl mx-auto rounded-2xl border border-border/40 p-8 bg-muted/30 text-center">
          <h2 className="text-xl font-bold mb-3">What jobs can I request?</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Plumbing, painting, garden work, general handyman, appliance repair, DIY assistance, and roofing. If it&apos;s a small job around the home, there&apos;s likely a provider near you who can do it.
          </p>
          <Button
            nativeButton={false}
            render={<Link href="/solutions" />}
            variant="outline"
            size="sm"
          >
            See all job types →
          </Button>
        </div>
      </section>

      <CTAStrip />
    </>
  );
}
