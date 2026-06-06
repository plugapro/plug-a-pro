"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormFeedback } from "@/components/shared/FormFeedback";
import { marketingConsentText } from "@/content/marketing/consent";

type Journey = "customer" | "provider";

const journeyOptions: Array<{
  value: Journey;
  label: string;
  description: string;
}> = [
  {
    value: "customer",
    label: "I need a service",
    description: "Book help for repairs, installs, maintenance or household jobs.",
  },
  {
    value: "provider",
    label: "I offer services",
    description: "Join as a service provider and start getting matched to work.",
  },
];

export function OnboardingForm() {
  const [phone, setPhone] = useState("");
  const [journey, setJourney] = useState<Journey>("customer");
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
          type: "onboarding",
          phone,
          journey,
          source: "/onboarding",
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
          Your details are saved. WhatsApp should open automatically - if it doesn&apos;t, tap below.
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
            setWhatsappConsentAccepted(false);
          }}
        >
          Register a different number
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-3">
        {journeyOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setJourney(option.value)}
            className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
              journey === option.value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background hover:border-foreground/40 hover:bg-muted/60"
            }`}
          >
            <div className="text-sm font-semibold">{option.label}</div>
            <div
              className={`mt-1 text-sm leading-5 ${
                journey === option.value ? "text-background/80" : "text-muted-foreground"
              }`}
            >
              {option.description}
            </div>
          </button>
        ))}
      </div>

      <div>
        <label htmlFor="onboarding-phone" className="mb-1.5 block text-sm font-medium">
          Cell phone number
        </label>
        <Input
          id="onboarding-phone"
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
            Start on WhatsApp
            <MessageCircle className="ml-2 h-4 w-4" />
          </>
        )}
      </button>

      <p className="text-xs leading-5 text-muted-foreground">
        This consent is recorded with the WhatsApp handoff so support can audit how the conversation started.
      </p>
    </form>
  );
}
