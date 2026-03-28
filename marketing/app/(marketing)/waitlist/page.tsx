import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { WaitlistForm } from "@/components/marketing/WaitlistForm";

export const metadata: Metadata = buildMetadata({ title: "Get Early Access" });

export default function WaitlistPage() {
  return (
    <div className="py-24 max-w-md mx-auto px-4 text-center">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
        Early access
      </p>
      <h1 className="text-4xl font-bold mb-4">We&apos;re launching soon</h1>
      <p className="text-muted-foreground mb-2">
        Plug-A-Pro is launching in <strong className="text-foreground">Johannesburg &amp; Pretoria</strong> first.
      </p>
      <p className="text-muted-foreground mb-8">
        Join the list and we&apos;ll reach out on WhatsApp when you can book your
        first job, or start getting work as a worker.
      </p>
      <WaitlistForm />
      <p className="text-xs text-muted-foreground mt-6">
        Free for customers. Workers pay a small lead fee once they start earning.
      </p>
    </div>
  );
}
