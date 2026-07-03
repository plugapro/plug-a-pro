import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { ContactForm } from "@/components/marketing/ContactForm";
import { WhatsAppButton } from "@/components/marketing/WhatsAppButton";

export const metadata: Metadata = buildMetadata({
  title: "Contact",
  description:
    "Get in touch with Plug A Pro on WhatsApp or through the contact form - support for customers, service providers and partnership enquiries.",
});

export default function ContactPage() {
  return (
    <div className="py-24 max-w-md mx-auto px-4">
      <h1 className="text-4xl font-bold mb-4">Contact us</h1>
      <p className="text-muted-foreground mb-8">
        We&apos;d love to hear from you.
      </p>
      <ContactForm />
      <div className="mt-8 border-t border-border/40 pt-8">
        <p className="text-sm text-muted-foreground mb-3">Or reach us directly:</p>
        <WhatsAppButton />
      </div>
    </div>
  );
}
