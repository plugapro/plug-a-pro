import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { Features } from "@/components/marketing/Features";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "Features",
  description:
    "See how Plug A Pro handles matching, quoting, job tracking, communication and reviews - from first message to completed job.",
});

export default function FeaturesPage() {
  return (
    <>
      <div className="py-24 text-center px-4">
        <h1 className="text-5xl font-bold mb-4">How Plug A Pro keeps the job on track</h1>
        <p className="text-muted-foreground text-xl max-w-xl mx-auto">
          From the first message to the final photo, Plug A Pro keeps the quote, job status and communication in one place - for customers and service providers both.
        </p>
      </div>
      <Features />
      <CTAStrip />
    </>
  );
}
