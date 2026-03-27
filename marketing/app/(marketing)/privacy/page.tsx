import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata({ title: "Privacy Policy", noIndex: false });

export default function PrivacyPage() {
  return (
    <div className="py-24 max-w-3xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <p>Last updated: January 1, 2024</p>
        <p>Replace this with your actual privacy policy content.</p>
        <h2>Information we collect</h2>
        <p>Placeholder content.</p>
        <h2>How we use your data</h2>
        <p>Placeholder content.</p>
      </div>
    </div>
  );
}
