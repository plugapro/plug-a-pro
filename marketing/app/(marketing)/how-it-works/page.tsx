import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { CTAStrip } from "@/components/marketing/CTAStrip";
import Link from "next/link";

export const metadata: Metadata = buildMetadata({
  title: "How It Works",
  description:
    "See exactly how Plug-A-Pro manages the full job lifecycle — from WhatsApp booking through dispatch, on-site execution, and invoicing.",
});

const CUSTOMER_STEPS = [
  { step: "1", title: "Customer sends \u2018Hi\u2019", detail: "Your customer messages your Plug-A-Pro WhatsApp number. A guided menu appears immediately. No waiting, no human needed." },
  { step: "2", title: "Browse and select a service", detail: "The bot lists your service categories and prices. Customer taps to choose. All done through WhatsApp interactive buttons." },
  { step: "3", title: "Provide address", detail: "Customer types their suburb and street address. The bot confirms it back before continuing." },
  { step: "4", title: "Choose a time slot", detail: "Available date and time windows are shown based on your configured slots. Customer taps to choose." },
  { step: "5", title: "Confirm and pay", detail: "Full booking summary shown — service, address, slot, price. Customer confirms and receives a secure Peach Payments link. Supports card, EFT, and instant EFT." },
  { step: "6", title: "Booking confirmed via WhatsApp", detail: "Payment webhook fires immediately. Booking is confirmed. Customer receives a confirmation message with their reference number." },
];

const DISPATCH_STEPS = [
  { step: "1", title: "New booking appears in your console", detail: "Every confirmed booking lands in your admin dashboard in real time. You see service type, address, time slot, and payment status." },
  { step: "2", title: "Assign the right technician", detail: "One tap to assign a technician. The system checks their availability. Job is created and status set to ASSIGNED." },
  { step: "3", title: "Technician notified via WhatsApp", detail: "Your technician receives a WhatsApp message with full job details — service type, customer address, and scheduled time. They can accept from WhatsApp directly." },
];

const EXECUTION_STEPS = [
  { step: "1", title: "Technician marks \u2018On my way\u2019", detail: "Tapped from the PWA. Customer receives a WhatsApp notification: \u2018Your technician is on the way.\u2019" },
  { step: "2", title: "Technician arrives", detail: "Taps \u2018Arrived\u2019 on the job app. Customer is notified. Job status moves to ARRIVED." },
  { step: "3", title: "Job started — before photo uploaded", detail: "Technician taps \u2018Start job\u2019 and uploads a before photo. Immutable record created." },
  { step: "4", title: "Extra work approval (if needed)", detail: "If extra work is required, technician logs description and amount. Customer receives a WhatsApp approval link — they approve or decline before any extra work begins." },
  { step: "5", title: "Job completed — after photo uploaded", detail: "Technician marks complete and uploads after photo. Invoice auto-generated. Sent to customer via WhatsApp." },
  { step: "6", title: "Rating request sent 24 hours later", detail: "Automated follow-up. Customer rates the job. Your service record grows." },
];

function FlowSection({
  label,
  title,
  steps,
}: {
  label: string;
  title: string;
  steps: { step: string; title: string; detail: string }[];
}) {
  return (
    <div className="mb-16">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">{label}</p>
      <h2 className="text-2xl md:text-3xl font-bold mb-8">{title}</h2>
      <div className="space-y-0">
        {steps.map((s, i) => (
          <div key={s.step} className="flex gap-5">
            <div className="flex flex-col items-center">
              <div
                className="size-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{
                  background:
                    "linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-brand) 100%)",
                }}
              >
                {s.step}
              </div>
              {i < steps.length - 1 && (
                <div className="w-px flex-1 bg-border/60 my-1" />
              )}
            </div>
            <div className="pb-8">
              <h3 className="font-semibold mb-1">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <>
      <div className="py-16 md:py-20 px-4 border-b border-border/40 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          The full picture
        </p>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">How Plug-A-Pro works</h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-lg">
          Three flows. One connected platform. From the first WhatsApp message to the final invoice.
        </p>
      </div>

      <div className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <FlowSection
            label="Customer flow"
            title="Booking via WhatsApp — no app required"
            steps={CUSTOMER_STEPS}
          />
          <FlowSection
            label="Operations flow"
            title="Dispatch — assign the right technician"
            steps={DISPATCH_STEPS}
          />
          <FlowSection
            label="Technician flow"
            title="On-site execution via the PWA"
            steps={EXECUTION_STEPS}
          />

          <div className="rounded-2xl border border-border/40 p-6 bg-muted/30 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground mb-2">Identity continuity — WhatsApp ↔ PWA</p>
            <p>
              Customers who book via WhatsApp can sign into the PWA using their mobile number (phone OTP). Their full booking history is instantly available — no re-registration, no duplicate records.
            </p>
          </div>
        </div>
      </div>

      <CTAStrip />
    </>
  );
}
