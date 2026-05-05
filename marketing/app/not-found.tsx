import Link from "next/link";
import { buildMetadata } from "@/lib/metadata";
import type { Metadata } from "next";

export const metadata: Metadata = buildMetadata({ title: "Page Not Found", noIndex: true });

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-6xl font-bold mb-4">404</h1>
      <p className="text-xl text-muted-foreground mb-8">This page does not exist.</p>
      <Link href="/" className="text-sm underline underline-offset-4 hover:no-underline">
        Go home
      </Link>
    </div>
  );
}
