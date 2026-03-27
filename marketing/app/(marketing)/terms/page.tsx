import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Terms of Service" });

export default function TermsPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: January 1, 2024</p>
        <p>Replace this with your actual terms of service content.</p>
        <h2>Acceptance of terms</h2>
        <p>Placeholder content.</p>
        <h2>Use of service</h2>
        <p>Placeholder content.</p>
      </div>
    </div>
  );
}
