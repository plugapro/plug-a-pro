import type { Metadata } from "next";
import { CheckCircle2, MessageCircle, Phone } from "lucide-react";
import { buildMetadata } from "@/lib/metadata";
import { OnboardingForm } from "@/components/marketing/OnboardingForm";
import { whatsappNumberDisplay } from "@/lib/whatsapp";

export const metadata: Metadata = buildMetadata({
  title: "Get started",
  description:
    "Register with your cell phone number, tell Plug-A-Pro whether you need a service or offer one, and continue onboarding on WhatsApp.",
});

const highlights = [
  {
    title: "Cell phone first",
    description: "Register with the same number you use on WhatsApp so the conversation continues without email.",
    icon: Phone,
  },
  {
    title: "Built for both sides",
    description: "Customers, service providers, or people who do both use the same flow.",
    icon: CheckCircle2,
  },
  {
    title: "WhatsApp-led follow-up",
    description: "After saving your details we continue the onboarding on WhatsApp where most real work happens.",
    icon: MessageCircle,
  },
];

export default function OnboardingPage() {
  return (
    <div className="relative overflow-hidden py-16 sm:py-24">
      <div className="absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(circle_at_top,rgba(37,211,102,0.16),transparent_45%),radial-gradient(circle_at_20%_20%,rgba(34,197,94,0.12),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.03),transparent)]" />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-[1.05fr_0.95fr] lg:px-6">
        <section className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent-green-wa)]">
            WhatsApp onboarding
          </p>
          <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Self-register with your cell phone and continue on WhatsApp.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            Plug-A-Pro works best when the first touchpoint matches how people already communicate. Register as a customer,
            a service provider, or both, then move straight into WhatsApp on {whatsappNumberDisplay}.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {highlights.map((item) => {
              const Icon = item.icon;

              return (
                <div key={item.title} className="rounded-3xl border border-border bg-background/85 p-5 shadow-sm backdrop-blur">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--accent-green-wa)]/12 text-[color:var(--accent-green-wa)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-[2rem] border border-border bg-background p-5 shadow-xl sm:p-7">
          <div className="mb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-green-wa)]">
              Get started
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Tell us who you are and what you need.</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Pick your role, enter your number, and we'll open a WhatsApp conversation to continue from there.
            </p>
          </div>
          <OnboardingForm />
          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            Customers register free. Providers only pay once the earning side of the platform is active.
          </p>
        </section>
      </div>
    </div>
  );
}
