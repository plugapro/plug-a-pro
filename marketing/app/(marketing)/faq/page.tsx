import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const metadata: Metadata = buildMetadata({ title: "FAQ" });

const FAQS = [
  { q: "What is this product?", a: "Replace with your product description." },
  { q: "How does pricing work?", a: "We offer Free, Pro ($29/mo), and Enterprise (custom) plans." },
  { q: "Is there a free trial?", a: "Yes — no credit card required." },
  { q: "How do I get support?", a: "Use the chat widget or visit /contact." },
  { q: "Can I cancel at any time?", a: "Yes, you can cancel your subscription at any time." },
];

export default function FAQPage() {
  return (
    <div className="py-24 max-w-2xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-12 text-center">Frequently asked questions</h1>
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
