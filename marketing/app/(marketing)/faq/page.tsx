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
    "Frequently asked questions about Plug A Pro — for customers who need small home job help and local service providers looking for steady work.",
});

const CUSTOMER_FAQS = [
  {
    q: "What is Plug A Pro?",
    a: "Plug A Pro connects people in South Africa to local service providers for small jobs. You describe your job, we match you to a rated local provider, and Plug A Pro keeps the quote, booking, and job updates in one written record.",
  },
  {
    q: "What types of jobs can I get help with?",
    a: "Plumbing, painting, garden and lawn care, handyman and odd jobs, appliance repairs, minor electrical, DIY assistance, roofing (minor), and general home repairs. If it's a small home job, describe it and we'll try to match you.",
  },
  {
    q: "Do I need to download an app?",
    a: "No. You can describe your job and get updates entirely through WhatsApp. No app, no account needed to start. There's also a web app if you want a fuller view of quotes and history.",
  },
  {
    q: "Will the provider see my phone number?",
    a: "Not by default. Plug A Pro handles the initial intake, matching, quote approval, and job updates from the platform number. If you and the provider want to share direct contact details later, that happens by choice.",
  },
  {
    q: "How do quotes work?",
    a: "After accepting a job, the provider sends a written quote with the description, price, and timeline. You approve before any work starts. If extra work comes up on-site, the provider must send a new request before they can proceed.",
  },
  {
    q: "What happens if something goes wrong?",
    a: "Contact Plug A Pro support on WhatsApp with a description of the issue and any photos. We'll follow up within 2 hours during business hours. We review the written quote, job history, before-and-after photos, and communication records. If the issue is about scope or price, the written record is the reference point. We aim to resolve disputes within 5 business days and will keep you updated as the process moves forward.",
  },
  {
    q: "Started a DIY project and got stuck?",
    a: "Yes, our providers can assess, continue, or finish a job you started yourself. Describe where you are and what you need and we'll match you to someone who can help.",
  },
  {
    q: "How do I pay?",
    a: "Payment is arranged through the platform after the job is done. Options will be communicated at the time of booking.",
  },
];

const WORKER_FAQS = [
  {
    q: "Who can register as a service provider?",
    a: "Anyone with practical home-job skills: plumbers, painters, gardeners, appliance repairers, electricians (minor work), and general maintenance providers. You don't need a registered company to join. For certain job types — electrical, gas, structural work — South African law may require a licence regardless of business registration. You are responsible for holding the right credentials for the work you offer.",
  },
  {
    q: "How do I register?",
    a: "Message the Plug A Pro WhatsApp number or fill in the web form. Tell us your name, what you do, which suburbs you cover, and your general availability. Your application is reviewed before you start receiving leads.",
  },
  {
    q: "How do leads work?",
    a: "When a customer job matches your skills and area, you receive a WhatsApp notification with the job category, suburb, and urgency. You accept or decline. If you accept, you get the full address and move forward to inspection or quoting through Plug A Pro.",
  },
  {
    q: "What information does the customer see about me?",
    a: "Your name, rating, and any reviews from past jobs. Your personal phone number is not shown to the customer by default.",
  },
  {
    q: "How does quoting work?",
    a: "After accepting a job, send a written quote with the description, price, and timeline. The customer approves before any work starts. If the scope changes, send an extra work request and wait for approval before proceeding.",
  },
  {
    q: "How do I get more customers?",
    a: "Every completed job adds a rating and optional comment from the customer. These show on your profile. The stronger your reputation, the more likely customers are to pick you again.",
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
        For customers looking for home-job help, and service providers building reliable work.
      </p>
      <FaqGroup label="For customers" items={CUSTOMER_FAQS} />
      <FaqGroup label="For service providers" items={WORKER_FAQS} />
    </div>
  );
}
