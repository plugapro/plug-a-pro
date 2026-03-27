import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const metadata: Metadata = buildMetadata({
  title: "FAQ",
  description: "Frequently asked questions about Plug-A-Pro — WhatsApp booking, dispatch, pricing, and how it works for field service businesses.",
});

const FAQS = [
  {
    q: "What is Plug-A-Pro?",
    a: "Plug-A-Pro is a field service management platform that lets customers book via WhatsApp, helps you dispatch technicians, and automates invoicing — all in one connected system.",
  },
  {
    q: "What types of businesses use Plug-A-Pro?",
    a: "Any business that sends skilled technicians to customer locations — plumbing, electrical, HVAC, home maintenance, locksmith, and more.",
  },
  {
    q: "Does the customer need to download an app?",
    a: "No. Customers book entirely through WhatsApp — no app download, no email registration required. Technicians use a lightweight PWA installed directly from a link, with no App Store required.",
  },
  {
    q: "Can I use Plug-A-Pro if I'm already managing bookings on WhatsApp?",
    a: "Yes — that's exactly who we're built for. Plug-A-Pro adds structure, dispatch, and automation on top of the WhatsApp channel your customers already use.",
  },
  {
    q: "Can customers book a job to finish a DIY repair they started?",
    a: "Yes. Customers can book any type of job through Plug-A-Pro — including repair assessments and project completion help. The booking flow handles any job description your service catalogue supports.",
  },
  {
    q: "How does payment work?",
    a: "Payment is collected before dispatch via a secure payment link sent through WhatsApp. Invoices are auto-generated and sent on job completion.",
  },
  {
    q: "How does pricing work?",
    a: "We offer Starter (R 999/mo), Growth (R 2 499/mo), and Enterprise (custom) plans. All plans include WhatsApp booking, dispatch, and invoicing. See our pricing page for a full comparison.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — our Growth plan includes a 14-day free trial. No credit card required to start.",
  },
  {
    q: "How do I get support?",
    a: "Use the chat widget on this page, send us a WhatsApp message, or visit the contact page.",
  },
];

export default function FAQPage() {
  return (
    <div className="py-24 max-w-2xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-4 text-center">Frequently asked questions</h1>
      <p className="text-muted-foreground text-center mb-12">Everything you need to know about Plug-A-Pro.</p>
      <Accordion className="w-full">
        {FAQS.map((faq, i) => (
          <AccordionItem key={i} value={`item-${i}`}>
            <AccordionTrigger>{faq.q}</AccordionTrigger>
            <AccordionContent>{faq.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
