import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { OnboardingForm } from "@/components/marketing/OnboardingForm";

export const metadata: Metadata = buildMetadata({
  title: "Get started",
  description:
    "Register with your cell phone number, tell Plug-A-Pro whether you need a service or offer one, and continue onboarding on WhatsApp.",
});

export default function OnboardingPage() {
  return (
    <div className="relative overflow-hidden py-16 sm:py-24">
      <div className="absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(circle_at_top,rgba(37,211,102,0.16),transparent_45%),radial-gradient(circle_at_20%_20%,rgba(34,197,94,0.12),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.03),transparent)]" />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-[1fr_1fr] lg:px-6">
        <section className="flex flex-col justify-center max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent-green-wa)]">
            WhatsApp onboarding
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Get started on WhatsApp in under a minute.
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground">
            Pick your role, enter your number. We'll open WhatsApp with the right context so the conversation starts in the right place.
          </p>
        </section>

        <section className="rounded-[2rem] border border-border bg-background p-5 shadow-xl sm:p-7">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">Who are you?</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Choose your role and enter your WhatsApp number.
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
