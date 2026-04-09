import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { Button } from "@/components/ui/button";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import {
  ShieldCheck,
  Eye,
  FileText,
  Camera,
  UserCheck,
  MessageSquare,
  AlertTriangle,
  Star,
} from "lucide-react";

export const metadata: Metadata = buildMetadata({
  title: "Trust & Safety",
  description:
    "How Plug-A-Pro protects customers and workers: careful contact handling, worker screening, written quotes, photo evidence, and manual support review.",
});

const CUSTOMER_PROTECTIONS = [
  {
    icon: Eye,
    title: "Your number stays private",
    body: "Plug-A-Pro handles the intake, matching, quote approval, and status updates from the platform number. Direct contact is not required to get the job booked and tracked.",
  },
  {
    icon: UserCheck,
    title: "Workers are manually reviewed",
    body: "Every worker who applies goes through a manual review before their profile goes live. We check the skills they claim, the areas they cover, and any available references or prior work evidence.",
  },
  {
    icon: FileText,
    title: "Written quotes before any work",
    body: "No job starts without a written, approved quote. The price and scope are confirmed before work begins. If extra work comes up on-site, it must be quoted and approved in writing before anything happens.",
  },
  {
    icon: Camera,
    title: "Before and after photos on every job",
    body: "Workers are required to attach before and after photos to the job record. If a dispute arises about the quality or completeness of work, there is photographic evidence from the site.",
  },
];

const WORKER_PROTECTIONS = [
  {
    icon: FileText,
    title: "Extra work is documented",
    body: "If the scope expands on-site, workers submit an extra work request through the platform. Customers approve in writing before the additional work begins. No more 'I never agreed to that.'",
  },
  {
    icon: Star,
    title: "Reviews build your reputation",
    body: "Every job you complete adds to your public rating. Customers who book you can see your track record. Good work builds over time. Your reputation is yours to keep.",
  },
  {
    icon: Eye,
    title: "Your number stays private too",
    body: "Workers also benefit from the platform-managed flow. Plug-A-Pro handles the intake, quote approval, and status updates so you do not have to share your personal number just to get started.",
  },
  {
    icon: ShieldCheck,
    title: "Written job record for payment follow-through",
    body: "The quote, extra work approvals, photos, and completion trail stay on record so payment discussions are anchored to something written instead of memory or verbal promises.",
  },
];

const DISPUTE_STEPS = [
  {
    number: "1",
    title: "Raise a dispute",
    detail:
      "Either the customer or the worker can contact Plug-A-Pro support. We open a manual review case and check the written job record before deciding next steps.",
  },
  {
    number: "2",
    title: "Both sides submit evidence",
    detail:
      "We ask both sides for their account of what happened, any photos, and the written quote. The job record gives support a starting point for the review.",
  },
  {
    number: "3",
    title: "Mediation review",
    detail:
      "A Plug-A-Pro team member reviews the evidence. We look at the written quote, the before/after photos, and the communication log.",
  },
  {
    number: "4",
    title: "Resolution",
    detail:
      "Based on the evidence, Plug-A-Pro sets the next step for the case and notifies both parties of the outcome and reasoning. Financial resolution depends on the payment method used for that job during the launch phase.",
  },
];

export default function TrustPage() {
  return (
    <>
      {/* Header */}
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Trust &amp; Safety
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Built on accountability. For both sides.
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
          Plug-A-Pro protects customers by documenting everything and screening workers. It protects workers by documenting agreements and keeping a clean service record. Everyone benefits from a system that keeps both sides accountable.
        </p>
      </div>

      {/* Anonymous communication */}
      <section className="py-20 px-4 border-b border-border/40">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
              <MessageSquare
                className="size-5"
                style={{ color: "var(--accent-brand)" }}
                aria-hidden="true"
              />
            </div>
            <h2 className="text-2xl font-bold">Anonymous communication</h2>
          </div>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            Plug-A-Pro manages the intake, matching, quote approval, and status updates from the platform number. That means the job can move forward without either side needing to exchange personal contact details at the start.
          </p>
          <div className="rounded-2xl border border-border/40 p-6 bg-muted/20">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">How it works:</strong> The job starts on the Plug-A-Pro WhatsApp number. Quotes and approval stay in writing, and both sides receive structured updates from Plug-A-Pro as the booking moves forward. If they later want direct contact, that happens outside the initial matching flow.
            </p>
          </div>
        </div>
      </section>

      {/* Customer protections */}
      <section className="py-20 px-4 border-b border-border/40">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-3">How we protect customers</h2>
          <p className="text-muted-foreground mb-10 max-w-xl">
            Letting a stranger into your home requires trust. These are the safeguards in place.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {CUSTOMER_PROTECTIONS.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.title}
                  className="rounded-2xl border border-border/40 p-6 flex gap-5"
                >
                  <div className="size-10 rounded-xl flex items-center justify-center bg-muted flex-shrink-0">
                    <Icon
                      className="size-5"
                      style={{ color: "var(--accent-brand)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{p.title}</h3>
                    <p className="text-sm text-muted-foreground">{p.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Worker protections */}
      <section className="py-20 px-4 border-b border-border/40">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-3">How we protect workers</h2>
          <p className="text-muted-foreground mb-10 max-w-xl">
            Independent workers take on real risk with every job. We document agreements so workers aren&apos;t left exposed.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {WORKER_PROTECTIONS.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.title}
                  className="rounded-2xl border border-border/40 p-6 flex gap-5"
                >
                  <div className="size-10 rounded-xl flex items-center justify-center bg-muted flex-shrink-0">
                    <Icon
                      className="size-5"
                      style={{ color: "var(--accent-brand)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{p.title}</h3>
                    <p className="text-sm text-muted-foreground">{p.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Dispute resolution */}
      <section className="py-20 px-4 border-b border-border/40">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
              <AlertTriangle
                className="size-5"
                style={{ color: "var(--accent-pink)" }}
                aria-hidden="true"
              />
            </div>
            <h2 className="text-2xl font-bold">Dispute resolution</h2>
          </div>
          <p className="text-muted-foreground mb-10 max-w-2xl">
            When something goes wrong, there is still a process. Plug-A-Pro reviews the quote, photos, and job history on record so support is working from written evidence rather than guesswork.
          </p>
          <div className="space-y-0">
            {DISPUTE_STEPS.map((s, i) => (
              <div key={s.number} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div
                    className="size-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-purple) 50%, var(--accent-brand) 100%)",
                    }}
                  >
                    {s.number}
                  </div>
                  {i < DISPUTE_STEPS.length - 1 && (
                    <div className="w-px flex-1 bg-border/60 my-1" />
                  )}
                </div>
                <div className="pb-8">
                  <h3 className="font-semibold mb-1">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {s.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What we don't cover */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto rounded-2xl border border-border/40 p-8 bg-muted/30">
          <h2 className="text-xl font-bold mb-4">What Plug-A-Pro isn&apos;t</h2>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-3">
              <span className="mt-1.5 size-1.5 rounded-full flex-shrink-0 bg-muted-foreground/40" />
              Workers on Plug-A-Pro are independent contractors, not Plug-A-Pro employees. We facilitate the match and provide a fair system for both sides. We are not the employer.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 size-1.5 rounded-full flex-shrink-0 bg-muted-foreground/40" />
              Plug-A-Pro is designed for small, defined home jobs. We don&apos;t facilitate large construction projects, ongoing employment arrangements, or work requiring a COC or formal contractor licence.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 size-1.5 rounded-full flex-shrink-0 bg-muted-foreground/40" />
              Workers are responsible for the quality of their own work. Plug-A-Pro provides the framework: reviews, photos, and written quotes. We do not warrant the outcome of any job.
            </li>
          </ul>
          <div className="mt-6 pt-6 border-t border-border/40">
            <p className="text-sm text-muted-foreground mb-4">
              Questions about a specific situation? Reach us directly.
            </p>
            <Button nativeButton={false} render={<Link href="/contact" />} variant="outline" size="sm">
              Contact us
            </Button>
          </div>
        </div>
      </section>

      <CTAStrip />
    </>
  );
}
