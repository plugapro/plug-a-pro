import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { WaitlistForm } from "@/components/marketing/WaitlistForm";

export const metadata: Metadata = buildMetadata({ title: "Join the Waitlist", noIndex: true });

export default function WaitlistPage() {
  return (
    <div className="py-24 max-w-md mx-auto px-4 text-center">
      <h1 className="text-4xl font-bold mb-4">Join the waitlist</h1>
      <p className="text-muted-foreground mb-8">
        Be the first to know when we launch.
      </p>
      <WaitlistForm />
    </div>
  );
}
