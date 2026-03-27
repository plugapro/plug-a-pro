import Link from "next/link";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/metadata";

export function CTAStrip() {
  const waNumber = siteConfig.whatsappNumber.replace(/\D/g, "");
  const waMessage = encodeURIComponent("Hi, I'd like to get started with Plug-A-Pro");

  return (
    <section className="py-20 md:py-24 px-4 border-t border-border/40">
      <div
        className="max-w-3xl mx-auto rounded-3xl p-10 md:p-14 text-center text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-brand) 100%)",
        }}
      >
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          Ready to run your service business on WhatsApp?
        </h2>
        <p className="text-white/80 mb-8 text-lg">
          Join Plug-A-Pro during our pilot phase. Free to get started. Built for South Africa.
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
            className="bg-white text-[oklch(0.50_0.22_290)] hover:bg-white/90 font-semibold text-base px-6"
          >
            💬 Start on WhatsApp
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/contact" />}
            size="lg"
            variant="outline"
            className="border-white/50 text-white hover:bg-white/10 text-base px-6"
          >
            Request a demo
          </Button>
        </div>
      </div>
    </section>
  );
}
