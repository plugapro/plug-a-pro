"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormFeedback } from "@/components/shared/FormFeedback";
import { analytics } from "@/lib/analytics";
import { marketingConsentText } from "@/content/marketing/consent";

type Magnet = "template-pack" | "dispatch-checklist" | "cashflow-tracker";

interface LeadMagnetFormProps {
  magnet: Magnet;
  source: string;
  submitLabel?: string;
}

export function LeadMagnetForm({
  magnet,
  source,
  submitLabel = "Send me the free resource",
}: LeadMagnetFormProps) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [whatsappConsentAccepted, setWhatsappConsentAccepted] = useState(false);

  useEffect(() => {
    if (status !== "success" || !whatsappUrl) return;
    const timer = window.setTimeout(() => {
      window.location.assign(whatsappUrl);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [status, whatsappUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage(undefined);

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "lead_magnet",
          phone,
          name: name || undefined,
          magnet,
          source,
          whatsappConsentAccepted,
        }),
      });

      const payload = (await res.json().catch(() => null)) as
        | { error?: string; whatsappUrl?: string }
        | null;

      if (!res.ok) {
        setErrorMessage(payload?.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      analytics.leadMagnetDownload(magnet, source);
      setWhatsappUrl(payload?.whatsappUrl ?? null);
      setStatus("success");
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-3xl border border-[color:var(--accent-green-wa)]/25 bg-[color:var(--accent-green-wa)]/8 p-6 text-left">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--accent-green-wa)] text-white shadow-lg">
          <MessageCircle className="h-6 w-6 animate-pulse" />
        </div>
        <h3 className="mt-4 text-2xl font-semibold">Opening WhatsApp…</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your number is saved. WhatsApp should open automatically - if it doesn&apos;t, tap below.
        </p>
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-full bg-[color:var(--accent-green-wa)] px-4 text-sm font-medium text-white transition-colors hover:bg-[color:var(--accent-green-wa)]/90"
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            Open WhatsApp
          </a>
        ) : null}
        <button
          type="button"
          className="mt-4 text-sm font-medium text-foreground underline underline-offset-4"
          onClick={() => {
            setStatus("idle");
            setWhatsappUrl(null);
            setPhone("");
            setName("");
            setWhatsappConsentAccepted(false);
          }}
        >
          Use a different number
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="lm-name" className="mb-1.5 block text-sm font-medium">
          Your name <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="lm-name"
          type="text"
          placeholder="Thabo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={status === "loading"}
          className="h-12 text-base"
        />
      </div>

      <div>
        <label htmlFor="lm-phone" className="mb-1.5 block text-sm font-medium">
          WhatsApp number
        </label>
        <Input
          id="lm-phone"
          type="tel"
          inputMode="tel"
          placeholder="+27 82 123 4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          disabled={status === "loading"}
          className="h-12 text-base"
        />
      </div>

      <FormFeedback
        status={status}
        successMessage="Saved."
        errorMessage={errorMessage}
      />

      <label className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/30 p-4 text-left">
        <input
          type="checkbox"
          checked={whatsappConsentAccepted}
          onChange={(e) => setWhatsappConsentAccepted(e.target.checked)}
          required
          disabled={status === "loading"}
          className="mt-1 size-4"
        />
        <span className="text-xs leading-5 text-muted-foreground">
          {marketingConsentText.whatsappTransactional.body}
        </span>
      </label>

      <button
        type="submit"
        disabled={status === "loading"}
        className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[color:var(--accent-green-wa)] px-4 text-sm font-medium text-white transition-colors hover:bg-[color:var(--accent-green-wa)]/90 disabled:opacity-60"
      >
        {status === "loading" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving…
          </>
        ) : (
          <>
            {submitLabel}
            <MessageCircle className="ml-2 h-4 w-4" />
          </>
        )}
      </button>

      <p className="text-xs leading-5 text-muted-foreground">
        We&apos;ll send this to you on WhatsApp. Free, no strings attached.
      </p>
    </form>
  );
}
