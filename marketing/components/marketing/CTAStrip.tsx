import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CTAStrip() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <h2 className="text-3xl font-bold">
          Need home help? Or want steady work?
        </h2>
        <p className="text-muted-foreground">
          Plug-A-Pro is built for both sides. Customers get trustworthy local help. Workers get structured access to paying jobs.
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
            Register as a worker
          </Button>
        </div>
      </div>
    </section>
  );
}
