import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { Button } from "@/components/ui/button";
import { CTAStrip } from "@/components/marketing/CTAStrip";
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
    "Get help with any small home job — plumbing, painting, gardening, handyman work, and more. Message us on WhatsApp and we'll match you to a nearby worker.",
});

const HOW_IT_WORKS = [
  {
    icon: MessageCircle,
    step: "01",
    title: "Describe your job on WhatsApp",
    detail:
      "Message the Plug-A-Pro WhatsApp number. Tell us what you need — plumbing leak, garden overgrown, wall needs painting. We'll ask a few short questions to understand the job.",
  },
  {
    icon: MapPin,
    step: "02",
    title: "We match you to nearby workers",
    detail:
      "We find available workers in your area who have the right skills. You'll see their profile, ratings, and reviews from previous customers before anyone contacts you.",
  },
  {
    icon: UserCheck,
    step: "03",
    title: "Confirm and book",
    detail:
      "If a worker needs to inspect the job first, we arrange a short visit before quoting. For straightforward jobs, the worker submits a quote directly. You approve before anything is scheduled.",
  },
  {
    icon: FileText,
    step: "04",
    title: "Approve the quote in writing",
    detail:
      "All quotes come through the platform. You review the price and scope, then approve in writing. No verbal agreements — everything is documented.",
  },
  {
    icon: Camera,
    step: "05",
    title: "Worker arrives and does the job",
    detail:
      "Your matched worker arrives at the agreed time. Before and after photos are attached to the job record. You can follow progress via WhatsApp.",
  },
  {
    icon: Star,
    step: "06",
    title: "Pay and leave a review",
    detail:
      "Once you're satisfied, payment is processed. Leave a review to help other customers and reward good workers. Your review builds the community.",
  },
];

const PROTECTIONS = [
  {
    icon: ShieldCheck,
    title: "Your number stays private",
    body: "We never share your personal phone number with workers. All communication goes through the platform until you choose to share contact details.",
  },
  {
    icon: UserCheck,
    title: "Workers are reviewed before joining",
    body: "Every worker on the platform goes through a manual application review. We check their skills, service area, and accept or decline based on quality signals.",
  },
  {
    icon: FileText,
    title: "Quotes in writing, always",
    body: "Nothing is agreed verbally. Every price and scope is confirmed in writing through the platform before work begins. No surprises.",
  },
  {
    icon: Camera,
    title: "Photo documentation",
    body: "Before-and-after photos are attached to every completed job. If there's a dispute about the quality of work, there's a record.",
  },
  {
    icon: Clock,
    title: "Platform mediation for disputes",
    body: "If something goes wrong, you can raise a dispute through us. The platform holds payment until the issue is resolved — we don't just release funds and disappear.",
  },
  {
    icon: Star,
    title: "Public reviews hold workers accountable",
    body: "Every completed job generates a review. Workers who perform badly don't get leads. Workers who do great work build a reputation that earns them more jobs.",
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
          Home jobs sorted — on WhatsApp
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg mb-8">
          Describe what you need. We&apos;ll match you to a nearby, reviewed worker. See their profile, approve a quote, and get the job done.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button nativeButton={false} render={<Link href="/waitlist" />} size="lg">
            Request help
          </Button>
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
            From your first WhatsApp message to a completed job — here&apos;s what to expect.
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
                          "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-brand) 100%)",
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
            Letting a stranger into your home takes trust. Here&apos;s how Plug-A-Pro builds it.
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
            Plumbing, painting, garden work, general handyman, appliance repair, minor electrical, DIY assistance, and roofing. If it&apos;s a small job around the home, there&apos;s likely a worker near you who can do it.
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
