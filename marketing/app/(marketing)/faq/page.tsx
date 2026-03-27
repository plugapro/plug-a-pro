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
  description:
    "Frequently asked questions about Plug-A-Pro — for customers looking for home-job help and workers looking for local jobs.",
});

const CUSTOMER_FAQS = [
  {
    q: "What is Plug-A-Pro?",
    a: "Plug-A-Pro is a marketplace that connects people in South Africa to nearby independent handymen and home-job workers. You describe your job, we match you to a rated local worker, and the whole process — quoting, booking, tracking, and payment — happens through the platform.",
  },
  {
    q: "What types of jobs can I get help with?",
    a: "Plumbing, painting, garden and lawn care, handyman and odd jobs, appliance repairs, minor electrical, DIY assistance, roofing (minor), and general home repairs. If it's a small home job, describe it — we'll try to match you.",
  },
  {
    q: "Do I need to download an app?",
    a: "No. You can describe your job and get updates entirely through WhatsApp — no app, no account needed to start. There's also a web app available for a richer view of quotes and history.",
  },
  {
    q: "Will the worker see my phone number?",
    a: "Not by default. All communication at the matching and quoting stage goes through the Plug-A-Pro platform. Your personal number is only shared if you and the worker explicitly agree to direct contact.",
  },
  {
    q: "How do quotes work?",
    a: "After accepting a lead, the worker sends a written quote through the platform — description, price, and timeline. You approve before any work starts. If extra work is needed on-site, the worker must send an additional request before proceeding.",
  },
  {
    q: "What happens if something goes wrong?",
    a: "Raise a dispute through the platform. We have the full job record — status history, photos, quotes, and messages. Disputes are reviewed and resolved by the Plug-A-Pro team.",
  },
  {
    q: "Started a DIY project and got stuck?",
    a: "Yes — our workers can assess, continue, or finish a job you started yourself. Describe where you are and what you need, and we'll match you to someone who can help.",
  },
  {
    q: "How do I pay?",
    a: "Payment is arranged through the platform after the job is done. Options will be communicated at the time of booking.",
  },
];

const WORKER_FAQS = [
  {
    q: "Who can register as a worker?",
    a: "Any individual with practical home-job skills — handymen, painters, plumbers (small jobs), gardeners, appliance repairers, electricians (minor work), and general DIY workers. You don't need a registered company to join.",
  },
  {
    q: "How do I register?",
    a: "Message the Plug-A-Pro WhatsApp number or fill in the web form. Tell us your name, what you do, which suburbs you cover, and your general availability. Your application is reviewed before you start receiving leads.",
  },
  {
    q: "How do leads work?",
    a: "When a customer job matches your skills and area, you receive a WhatsApp notification with the job category, suburb, and urgency. You accept or decline. If you accept, you get the full address and a platform message thread opens with the customer.",
  },
  {
    q: "What information does the customer see about me?",
    a: "Your name, rating, and any reviews from past jobs. Your personal phone number is not shown to the customer by default.",
  },
  {
    q: "How does quoting work?",
    a: "After accepting a lead, send a written quote through the app or WhatsApp — description, price, and timeline. The customer approves before any work starts. If the scope changes, log the extra work request and wait for approval before proceeding.",
  },
  {
    q: "How do I build my reputation?",
    a: "Every completed job adds a rating and optional comment from the customer. These appear on your profile and are visible to future customers when they're considering your quote.",
  },
  {
    q: "Is there a cost to join?",
    a: "Not at launch. We're in early access mode. Join now and we'll let you know how monetisation works before it affects you.",
  },
];

function FaqGroup({
  label,
  items,
}: {
  label: string;
  items: { q: string; a: string }[];
}) {
  return (
    <div className="mb-12">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
        {label}
      </p>
      <Accordion className="w-full">
        {items.map((faq, i) => (
          <AccordionItem key={i} value={`${label}-${i}`}>
            <AccordionTrigger>{faq.q}</AccordionTrigger>
            <AccordionContent>{faq.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

export default function FAQPage() {
  return (
    <div className="py-24 max-w-2xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-4 text-center">
        Frequently asked questions
      </h1>
      <p className="text-muted-foreground text-center mb-12">
        For customers looking for home-job help, and workers looking for local work.
      </p>
      <FaqGroup label="For customers" items={CUSTOMER_FAQS} />
      <FaqGroup label="For workers" items={WORKER_FAQS} />
    </div>
  );
}
