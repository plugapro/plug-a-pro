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
    title: "Only jobs near you",
    body: "Tell us which areas you work in once. You'll only get jobs you can actually reach.",
  },
  {
    icon: Smartphone,
    title: "Works on your WhatsApp",
    body: "Get job notifications, say yes or no, and talk to customers. All through the WhatsApp you already use. Nothing to download.",
  },
  {
    icon: ShieldCheck,
    title: "Your price in writing. No arguments.",
    body: "Your quote and any extra work are always written down and approved before you start. No more arguments about what was agreed.",
  },
  {
    icon: Star,
    title: "Good work gets you more work",
    body: "Every job you finish adds a rating to your name. Customers can see how good you are before they pick you.",
  },
];

const HOW_TO_JOIN = [
  {
    step: "1",
    title: "Sign up",
    detail:
      "Message us on WhatsApp or fill in the form below. Tell us your name, what jobs you do, which areas you cover, and when you're free.",
  },
  {
    step: "2",
    title: "We check your details",
    detail:
      "We look at your application before sending you any work. Once you're approved, your profile is live and customers in your area can find you.",
  },
  {
    step: "3",
    title: "Start getting work",
    detail:
      "When a job in your area matches what you do, you'll get a WhatsApp message. Say yes, talk to the customer through the app, send your price, do the job, and get paid.",
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
