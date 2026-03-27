import Link from "next/link";
import { Button } from "@/components/ui/button";

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
          Local help. Real quotes. Any small job.
        </p>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
          Get home help in minutes — not weeks
        </h1>
        <p className="text-xl text-muted-foreground mb-3 max-w-2xl mx-auto">
          Plug-A-Pro connects you to nearby handymen and home-job workers for
          small repairs, odd jobs, garden work, painting, and more. Message on
          WhatsApp. Get matched. Get it done.
        </p>
        <p className="text-sm text-muted-foreground mb-10 max-w-lg mx-auto">
          Started a DIY project and got stuck?{" "}
          <Link
            href="/how-it-works"
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--accent-brand)" }}
          >
            Our workers can assess, continue, or finish it.
          </Link>
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button
            nativeButton={false}
            render={<Link href="/waitlist" />}
            size="lg"
          >
            Request help
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/for-workers" />}
            variant="outline"
            size="lg"
          >
            I want work →
          </Button>
        </div>
      </div>
    </section>
  );
}
