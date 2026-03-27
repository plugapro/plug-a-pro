import Link from "next/link";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/metadata";

export function Hero() {
  return (
    <section className="py-24 md:py-32 text-center px-4">
      <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 max-w-3xl mx-auto">
        {siteConfig.name}
      </h1>
      <p className="text-xl text-muted-foreground mb-10 max-w-xl mx-auto">
        {siteConfig.description}
      </p>
      <div className="flex gap-4 justify-center flex-wrap">
        <Button nativeButton={false} render={<Link href={siteConfig.links.app} />} size="lg">
          Get started free
        </Button>
        <Button nativeButton={false} render={<Link href="/pricing" />} variant="outline" size="lg">
          See pricing
        </Button>
      </div>
    </section>
  );
}
