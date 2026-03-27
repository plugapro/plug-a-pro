import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CTAStrip } from "@/components/marketing/CTAStrip";

export const metadata: Metadata = buildMetadata({
  title: "FAQ",
  description: "Frequently asked questions about Plug-A-Pro — WhatsApp booking, technician app, pricing, payments, and how the platform works.",
});

const FAQS = [
  {
    q: "What is Plug-A-Pro?",
    a: "Plug-A-Pro is a field service management platform built for South African service businesses. It connects your customers, technicians, and operations team through WhatsApp and a lightweight PWA — managing the full job lifecycle from booking to invoice.",
  },
  {
    q: "Do my customers need to download an app?",
    a: "No. Customers book entirely through WhatsApp. No app download, no account creation, no email address needed. Your customer sends a message to your Plug-A-Pro number and a guided menu handles the rest. Works on any Android phone with WhatsApp.",
  },
  {
    q: "How do technicians receive and manage jobs?",
    a: "Technicians receive a WhatsApp notification when a job is assigned. They use a lightweight Progressive Web App (PWA) to manage job status on-site — marking themselves en route, arrived, started, and completed. The PWA installs from a link, like a website. No App Store required.",
  },
  {
    q: "Is Plug-A-Pro free to use?",
    a: "Plug-A-Pro is currently free during our pilot phase. We are onboarding select service businesses across South Africa. Pricing will be announced after the pilot closes. Get in touch to join.",
  },
  {
    q: "What payment methods does Plug-A-Pro support?",
    a: "The platform is integrated with Peach Payments — a South African payment provider that supports card payments, EFT, and instant EFT. All transactions are processed in ZAR.",
  },
  {
    q: "Can Plug-A-Pro handle extra work requests on-site?",
    a: "Yes. If a technician identifies additional work beyond the original scope, they log the description and amount through the job app. The customer receives a WhatsApp approval link and can approve or decline before any extra work begins. The decision is recorded against the job.",
  },
  {
    q: "How does the booking flow work for customers?",
    a: "Customers send \u2018Hi\u2019 to your Plug-A-Pro WhatsApp number. A guided menu walks them through selecting a service category, choosing a specific service with pricing, providing their address, selecting a time slot, and confirming payment. The whole process typically takes under 3 minutes.",
  },
  {
    q: "Can Plug-A-Pro handle multiple service types?",
    a: "Yes. You configure your own service catalogue, pricing rules, and service areas. Plug-A-Pro handles plumbing, electrical, cleaning, HVAC, and any other field service type where your business dispatches technicians to customer locations.",
  },
  {
    q: "What happens if a customer books via WhatsApp and later opens the PWA?",
    a: "Their history is fully preserved. When a customer signs into the PWA using their mobile number (phone OTP), the platform links their WhatsApp booking history to their session automatically. No re-registration, no duplicate records.",
  },
  {
    q: "How do I get started?",
    a: "Chat with us on WhatsApp and we\u2019ll walk you through onboarding your business. We\u2019ll configure your service catalogue, set up your WhatsApp number, and get your admin console ready. Onboarding typically takes one business day.",
  },
];

export default function FAQPage() {
  return (
    <>
      <div className="py-16 md:py-20 px-4 text-center border-b border-border/40">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Got questions?
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Frequently asked questions</h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Everything you need to know about Plug-A-Pro. Can&apos;t find what you&apos;re looking for?{" "}
          <a href="/contact" className="underline-offset-2 hover:underline" style={{ color: "var(--accent-brand)" }}>
            Get in touch.
          </a>
        </p>
      </div>
      <div className="py-16 max-w-2xl mx-auto px-4">
        <Accordion className="w-full">
          {FAQS.map((faq, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger>{faq.q}</AccordionTrigger>
              <AccordionContent>{faq.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
      <CTAStrip />
    </>
  );
}
