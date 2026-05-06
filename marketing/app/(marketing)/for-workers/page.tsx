import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { Button } from "@/components/ui/button";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import { Smartphone, MapPin, Star, ShieldCheck } from "lucide-react";
import { whatsappNumberDisplay } from "@/lib/whatsapp";
import { WhatsAppCtaButton } from "@/components/marketing/WhatsAppCtaButton";

export const metadata: Metadata = buildMetadata({
  title: "For Service Providers",
  description:
    "Register as a local service provider on Plug A Pro. Get matched to nearby customers for small home jobs, receive WhatsApp lead alerts, submit quotes in writing, and build your reputation with real reviews.",
});

const BENEFITS = [
  {
    icon: MapPin,
    title: "Leads matched to your area",
    body: "Tell us which areas you work in once. Eligible requests are matched against your service areas, skills, and availability.",
  },
  {
    icon: Smartphone,
    title: "Works on your WhatsApp",
    body: "Start onboarding, receive lead previews, and open secure job links from the WhatsApp you already use.",
  },
  {
    icon: ShieldCheck,
    title: "Controlled access to real requests",
    body: "Your application is reviewed before marketplace access. Paid leads are unlocked with credits before full customer details are released.",
  },
  {
    icon: Star,
    title: "Build a visible work record",
    body: "Accepted jobs, quotes, updates, photos, and customer reviews help turn your service history into a stronger digital profile.",
  },
];

const HOW_TO_JOIN = [
  {
    step: "1",
    title: "Start on WhatsApp",
    detail:
      "Tell Plug A Pro your name, what jobs you do, which areas you cover, when you're normally available, and upload the requested evidence or photos.",
  },
  {
    step: "2",
    title: "Operations reviews your application",
    detail:
      "We review the details before marketplace access. If you are rejected, you receive a WhatsApp update and cannot access live provider leads.",
  },
  {
    step: "3",
    title: "Activate your provider profile",
    detail:
      "If approved, your provider record is activated. You can open the Provider PWA, sign in with phone OTP, review your profile, set availability, and check wallet credits.",
  },
  {
    step: "4",
    title: "Unlock leads with credits",
    detail:
      "When a matching job is available, you receive a WhatsApp lead preview. You unlock the lead with credits before full customer details are shown and before you accept.",
  },
  {
    step: "5",
    title: "Accept, quote, and update the job",
    detail:
      "After acceptance, Plug A Pro notifies the customer and the job moves into handover. You can contact the customer, submit a quote, schedule arrival, and update progress from your phone.",
  },
];

export default function ForWorkersPage() {
  return (
    <>
      {/* Header */}
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          For service providers
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          More jobs. Less waiting.
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg mb-8">
          You have the skills. Getting steady, paying customers is the hard part. Plug A Pro matches you to nearby customers looking for exactly your trade — and delivers job lead previews to your WhatsApp. Register once. Set your areas. Start receiving matched jobs.
        </p>
        <p className="text-sm font-medium mb-8">
          Start on WhatsApp at {whatsappNumberDisplay}
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <WhatsAppCtaButton
            audience="worker"
            label="Start on WhatsApp"
            source="for_workers_header"
            size="lg"
          />
          <Button
            nativeButton={false}
            render={<Link href="/how-it-works" />}
            variant="outline"
            size="lg"
          >
            See how it works
          </Button>
        </div>
      </div>

      {/* Benefits */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            What the provider journey gives you
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {BENEFITS.map((b) => {
              const Icon = b.icon;
              return (
                <div
                  key={b.title}
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
                    <h3 className="font-semibold mb-1">{b.title}</h3>
                    <p className="text-sm text-muted-foreground">{b.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How to join */}
      <section className="py-16 px-4 border-t border-border/40">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            How to join
          </h2>
          <div className="space-y-0">
            {HOW_TO_JOIN.map((s, i) => (
              <div key={s.step} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div
                    className="size-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-purple) 50%, var(--accent-brand) 100%)",
                    }}
                  >
                    {s.step}
                  </div>
                  {i < HOW_TO_JOIN.length - 1 && (
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

      {/* Who we're looking for */}
      <section className="py-16 px-4 border-t border-border/40">
        <div className="max-w-3xl mx-auto rounded-2xl border border-border/40 p-8 bg-muted/30">
          <h2 className="text-xl font-bold mb-4">Who can join</h2>
          <p className="text-sm text-muted-foreground mb-4">
            You don&apos;t need a formal business or company registration to apply. If you have practical skills and a track record of doing good work, we want to hear from you.
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            For electrical, gas, and structural work, South African law requires specific licences regardless of business registration. You are responsible for holding any credentials that apply to the work you offer. Plug A Pro records the types of work you list but does not verify your licences unless a specific check is requested.
          </p>
          <ul className="grid grid-cols-2 gap-2 mb-6">
            {[
              "Gardeners and landscapers",
              "Painters",
              "Handymen and general repairs",
              "Plumbers (small jobs)",
              "Appliance repairers",
              "Electricians (minor work)",
              "DIY and handyman specialists",
              "Furniture and fixture installers",
            ].map((type) => (
              <li
                key={type}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <span
                  className="size-1.5 rounded-full flex-shrink-0"
                  style={{ background: "var(--accent-green-wa)" }}
                  aria-hidden="true"
                />
                {type}
              </li>
            ))}
          </ul>
          <WhatsAppCtaButton
            audience="provider"
            label="Join on WhatsApp"
            source="for_workers_provider_join"
            size="sm"
          />
        </div>
      </section>

      <CTAStrip />
    </>
  );
}
