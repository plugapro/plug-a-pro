import Link from "next/link";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/metadata";

export function CTAStrip() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <h2 className="text-3xl font-bold">Ready to get started?</h2>
        <p className="text-muted-foreground">
          Join thousands of teams already using {siteConfig.name}.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button nativeButton={false} render={<Link href={siteConfig.links.app} />} size="lg">
            Get started free
          </Button>
          <Button nativeButton={false} render={<Link href="/contact" />} variant="outline" size="lg">
            Talk to us
          </Button>
        </div>
      </div>
    </section>
  );
}
