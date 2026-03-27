import Link from "next/link";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/metadata";

export function Hero() {
  const waNumber = siteConfig.whatsappNumber.replace(/\D/g, "");
  const waMessage = encodeURIComponent("Hi, I'd like to get started with Plug-A-Pro");

  return (
    <section className="relative py-24 md:py-32 px-4 overflow-hidden">
      {/* Subtle gradient background tint */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.08]"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, var(--accent-pink), transparent)",
        }}
        aria-hidden="true"
      />

      <div className="relative max-w-3xl mx-auto text-center">
        {/* Eyebrow */}
        <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground mb-6 border border-border/60 rounded-full px-3 py-1">
          <span className="size-1.5 rounded-full bg-[var(--accent-green-wa)]" aria-hidden="true" />
          WhatsApp-first field service · Built for South Africa
        </p>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
          Run your entire service business{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-brand) 100%)",
            }}
          >
            from WhatsApp
          </span>
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
          Plug-A-Pro connects your customers, technicians, and back office in one mediated platform.
          Book, dispatch, complete, and invoice — all via WhatsApp.{" "}
          <span className="text-foreground font-medium">No app download. Built for South Africa.</span>
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            nativeButton={false}
            render={
              <Link
                href={`https://wa.me/${waNumber}?text=${waMessage}`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            size="lg"
            className="btn-gradient text-base px-6"
          >
            💬 Start on WhatsApp
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/how-it-works" />}
            size="lg"
            variant="outline"
            className="text-base px-6"
          >
            See how it works →
          </Button>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Free during our pilot phase · No app download required · ZAR payments
        </p>
      </div>
    </section>
  );
}
