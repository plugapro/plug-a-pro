import type { LucideIcon } from "lucide-react";
import { MessageCircle, Navigation, Smartphone, FileText, ClipboardCheck, Camera } from "lucide-react";

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: MessageCircle,
    title: "WhatsApp Booking",
    description:
      "Customers book by sending 'Hi'. Guided menus handle service selection, address, time slot, and payment — all inside WhatsApp.",
  },
  {
    icon: Navigation,
    title: "Smart Dispatch",
    description:
      "New bookings land in your admin console the moment they're confirmed. Assign the right technician in one tap — they're notified on WhatsApp instantly.",
  },
  {
    icon: Smartphone,
    title: "Technician PWA",
    description:
      "Lightweight job app installed from a link — no App Store. Status updates, photo uploads, and extra work approval on any budget Android.",
  },
  {
    icon: FileText,
    title: "Auto-Invoicing",
    description:
      "Invoice generated the moment a job is marked complete. Sent to the customer via WhatsApp automatically. No manual billing.",
  },
  {
    icon: ClipboardCheck,
    title: "Extra Work Approval",
    description:
      "If the scope changes on-site, technicians log it and customers approve via WhatsApp before any extra work begins. No verbal disputes.",
  },
  {
    icon: Camera,
    title: "Before & After Photos",
    description:
      "Before and after photos uploaded on every job. Immutable audit trail for compliance, quality control, and disputed invoices.",
  },
];

export function Features() {
  return (
    <section className="py-16 px-4 border-t border-border/40">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">Everything you need to run the field</h2>
        <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
          One platform. WhatsApp in. Invoice out. Everything in between — tracked, documented, and automated.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="space-y-3">
                <div className="size-10 rounded-xl flex items-center justify-center bg-muted">
                  <Icon className="size-5" style={{ color: "var(--accent-brand)" }} aria-hidden="true" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
