import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import { Button } from "@/components/ui/button";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import { Smartphone, MapPin, Star, ShieldCheck } from "lucide-react";

export const metadata: Metadata = buildMetadata({
  title: "For Workers",
  description:
    "Register as a home-job worker on Plug-A-Pro. Get matched to local customers, receive structured leads, submit quotes, and build your reputation.",
});

const BENEFITS = [
  {
    icon: MapPin,
    title: "Jobs matched to your area",
    body: "Set your coverage suburbs once. Only receive leads for jobs you can actually reach.",
  },
  {
    icon: Smartphone,
    title: "Everything runs on WhatsApp",
    body: "Receive leads, accept jobs, and get notified — all through the WhatsApp you already use. No app store required.",
  },
  {
    icon: ShieldCheck,
    title: "Structured quotes protect you",
    body: "Quotes and extra work requests are documented in writing. No more verbal disputes over what was agreed.",
  },
  {
    icon: Star,
    title: "Reviews build your business",
    body: "Every completed job adds a rating to your public profile. Customers see your track record before they choose you.",
  },
];

const HOW_TO_JOIN = [
  {
    step: "1",
    title: "Register",
    detail:
      "Message the Plug-A-Pro WhatsApp number or fill in the form below. Tell us your name, the types of jobs you do, which suburbs you cover, and your availability.",
  },
  {
    step: "2",
    title: "Get reviewed",
    detail:
      "Your application goes through a quick review. Once approved, your profile is active and you're ready to receive matched leads.",
  },
  {
    step: "3",
    title: "Start receiving work",
    detail:
      "When a job matches your skills and area, you'll get a WhatsApp notification. Accept the lead, communicate through the platform, submit your quote, do the job, get paid.",
  },
];

export default function ForWorkersPage() {
  return (
    <>
      {/* Header */}
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          For workers
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Your skills. Steady local work.
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg mb-8">
          Plug-A-Pro brings paying home-job customers to you. Register once, set your areas and skills, and start receiving matched leads on WhatsApp.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button nativeButton={false} render={<Link href="/waitlist" />} size="lg">
            Register as a worker
          </Button>
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
            What you get when you join
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
                        "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-brand) 100%)",
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
          <h2 className="text-xl font-bold mb-4">Who we&apos;re looking for</h2>
          <p className="text-sm text-muted-foreground mb-4">
            You don&apos;t need a formal business or company registration to join. If you have practical skills and a track record of doing good work, we want to hear from you.
          </p>
          <ul className="grid grid-cols-2 gap-2 mb-6">
            {[
              "Gardeners and landscapers",
              "Painters",
              "Handymen and odd-job workers",
              "Plumbers (small jobs)",
              "Appliance repairers",
              "Electricians (minor work)",
              "General DIY workers",
              "Installers",
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
          <Button nativeButton={false} render={<Link href="/waitlist" />} size="sm">
            Register now
          </Button>
        </div>
      </section>

      <CTAStrip />
    </>
  );
}
