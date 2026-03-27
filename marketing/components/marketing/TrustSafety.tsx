import {
  Phone,
  UserCheck,
  FileText,
  Camera,
  MessageCircle,
  Star,
} from "lucide-react";
import React from "react";

const TRUST_POINTS: {
  icon: React.ElementType;
  title: string;
  body: string;
}[] = [
  {
    icon: Phone,
    title: "Your number stays private",
    body: "By default, your personal WhatsApp number is not shared with the other party. All messages go through the Plug-A-Pro platform.",
  },
  {
    icon: UserCheck,
    title: "Workers are screened before activation",
    body: "Every provider goes through a review process before they can receive leads. Suspended workers cannot return without re-review.",
  },
  {
    icon: FileText,
    title: "All quotes are documented",
    body: "Quotes are submitted through the platform, not verbally. You see the price before agreeing — and so does your worker.",
  },
  {
    icon: Camera,
    title: "Before and after photos on every job",
    body: "Workers upload photos at the start and end of every job. Immutable proof — for your protection and theirs.",
  },
  {
    icon: MessageCircle,
    title: "Disputes handled on the platform",
    body: "If something goes wrong, raise it through the platform. We have the full job record — status history, photos, quotes, and messages.",
  },
  {
    icon: Star,
    title: "Ratings build over time",
    body: "Every completed job adds a review to the worker's profile. You can see their track record before accepting a quote.",
  },
];

export function TrustSafety() {
  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            Trust & safety
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Built for two strangers to work together safely
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Every feature is designed so neither side has to take an uncomfortable leap of faith.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TRUST_POINTS.map((point) => {
            const Icon = point.icon;
            return (
              <div
                key={point.title}
                className="rounded-2xl border border-border/40 p-6 space-y-3"
              >
                <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                  <Icon
                    className="size-5"
                    style={{ color: "var(--accent-brand)" }}
                    aria-hidden="true"
                  />
                </div>
                <h3 className="font-semibold text-sm">{point.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {point.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
