import Link from "next/link";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/metadata";

export function Hero() {
  return (
    <section className="relative py-24 md:py-32 text-center px-4 overflow-hidden">
      {/* subtle dot-grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.07]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
        aria-hidden="true"
      />
      <div className="relative max-w-4xl mx-auto">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
          Field service, simplified
        </p>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
          Book a technician in minutes — via WhatsApp
        </h1>
        <p className="text-xl text-muted-foreground mb-3 max-w-xl mx-auto">
          {siteConfig.description}
        </p>
        <p className="text-sm text-muted-foreground mb-10 max-w-lg mx-auto">
          Started a DIY job and need a pro to finish it?{" "}
          <Link
            href="/solutions"
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--accent-brand)" }}
          >
            We handle that too.
          </Link>
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button nativeButton={false} render={<Link href="/waitlist" />} size="lg">
            Get early access
          </Button>
          <Button nativeButton={false} render={<Link href="/how-it-works" />} variant="outline" size="lg">
            See how it works
          </Button>
        </div>
      </div>
    </section>
  );
}
