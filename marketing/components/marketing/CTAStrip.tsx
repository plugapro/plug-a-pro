import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CTAStrip() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <h2 className="text-3xl font-bold">Ready to modernise your field service business?</h2>
        <p className="text-muted-foreground">
          Plug-A-Pro handles booking, dispatch, and invoicing so you can focus on the work.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button nativeButton={false} render={<Link href="/waitlist" />} size="lg">
            Get early access
          </Button>
          <Button nativeButton={false} render={<Link href="/contact" />} variant="outline" size="lg">
            Talk to us
          </Button>
        </div>
      </div>
    </section>
  );
}
