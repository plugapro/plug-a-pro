"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";

export function CTAStrip() {
  return (
    <section
      className="py-16 px-4"
      style={{
        background:
          "linear-gradient(135deg, var(--accent-brand) 0%, oklch(0.42 0.22 260) 100%)",
        "--foreground": "oklch(0.985 0 0)",
        "--muted-foreground": "oklch(0.985 0 0 / 0.8)",
        "--primary": "oklch(0.985 0 0)",
        "--primary-foreground": "oklch(0.14 0.07 250)",
        "--border": "oklch(1 0 0 / 30%)",
      } as React.CSSProperties}
    >
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <h2 className="text-3xl font-bold text-white">
          Your next job sorted. Your next customer waiting.
        </h2>
        <p style={{ color: "oklch(0.985 0 0 / 0.8)" }}>
          Plug-A-Pro is built for both sides. Customers get trustworthy local help. Workers get structured access to paying jobs.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button
            nativeButton={false}
            render={<Link href="/waitlist" />}
            size="lg"
            onClick={() => analytics.ctaClick("Get early access", "cta_strip", "customer")}
          >
            Get early access
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/for-workers" />}
            variant="outline"
            size="lg"
            onClick={() => analytics.ctaClick("Register as a worker", "cta_strip", "worker")}
          >
            Register as a worker
          </Button>
        </div>
      </div>
    </section>
  );
}
