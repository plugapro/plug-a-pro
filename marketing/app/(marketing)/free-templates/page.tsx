import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { LeadMagnetForm } from "@/components/marketing/LeadMagnetForm";

export const metadata: Metadata = buildMetadata({
  title: "Free WhatsApp Template Pack for Service Providers",
  description:
    "5 ready-to-use WhatsApp message templates for South African independent service providers and small service teams.",
});

const templates = [
  {
    title: "New job request acknowledgement",
    preview: "Hi [Name], thanks for reaching out. We received your request and will send you a quote within [X] hours.",
  },
  {
    title: "Quote ready",
    preview: "Hi [Name], your quote for [job] is ready. Total: R[amount]. Reply YES to confirm your booking.",
  },
  {
    title: "Booking confirmation",
    preview: "Hi [Name], your booking is confirmed for [date] between [time window]. Your provider will be [name].",
  },
  {
    title: "Provider on the way",
    preview: "Hi [Name], your provider [name] is on the way and should arrive in approximately [X] minutes.",
  },
  {
    title: "Job complete — payment request",
    preview: "Hi [Name], the job is complete. Your invoice for R[amount] is attached. Pay here: [link]. Thank you.",
  },
];

export default function FreeTemplatesPage() {
  return (
    <div className="relative overflow-hidden py-16 sm:py-24">
      <div className="absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(circle_at_top,rgba(37,211,102,0.16),transparent_45%),radial-gradient(circle_at_20%_20%,rgba(34,197,94,0.12),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.03),transparent)]" />

      <div className="mx-auto max-w-6xl px-4 lg:px-6">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent-green-wa)]">
            Free resource
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            WhatsApp Template Pack for Service Providers
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground">
            5 ready-to-use WhatsApp messages for every stage of a service job. Copy, paste, and send.
            Built for South African independent providers and small service teams.
          </p>
        </div>

        {/* Two-column layout */}
        <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
          {/* Left: what's included */}
          <section className="space-y-6">
            <h2 className="text-xl font-semibold">What&apos;s included</h2>
            <ol className="space-y-4">
              {templates.map((t, i) => (
                <li key={t.title} className="flex gap-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent-green-wa)]/12 text-xs font-semibold text-[color:var(--accent-green-wa)]">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{t.title}</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground italic">&ldquo;{t.preview}&rdquo;</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="rounded-2xl border border-border bg-muted/40 px-5 py-4 text-sm leading-6 text-muted-foreground">
              <strong className="text-foreground">How it works:</strong> Enter your WhatsApp number.
              We&apos;ll open a WhatsApp conversation and send you all 5 templates instantly.
              Free. No account required.
            </div>
          </section>

          {/* Right: form */}
          <section className="rounded-[2rem] border border-border bg-background p-5 shadow-xl sm:p-7">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold">Get the templates free</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Enter your WhatsApp number and we&apos;ll send them through right away.
              </p>
            </div>
            <LeadMagnetForm
              magnet="template-pack"
              source="/free-templates"
              submitLabel="Send me the 5 templates"
            />
          </section>
        </div>

        {/* Other lead magnets */}
        <div className="mt-16 border-t border-border pt-14">
          <h2 className="text-center text-lg font-semibold">Other free resources</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background p-5">
              <p className="text-sm font-semibold">Daily Dispatch Checklist</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                A one-page printable checklist for providers and service team managers to check jobs before leaving for site.
              </p>
              <a
                href={buildWhatsAppLink("Hi Plug A Pro, I'd like the free dispatch checklist please.")}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex h-9 items-center rounded-full border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
              >
                Get on WhatsApp →
              </a>
            </div>

            <div className="rounded-2xl border border-border bg-background p-5">
              <p className="text-sm font-semibold">Cash Flow Tracker (Google Sheets)</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Track jobs, invoices, and payment status. Includes a dashboard showing outstanding invoices and monthly revenue.
              </p>
              <a
                href={buildWhatsAppLink("Hi Plug A Pro, I'd like the free cash flow tracker please.")}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex h-9 items-center rounded-full border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
              >
                Get on WhatsApp →
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
