"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormFeedback } from "@/components/shared/FormFeedback";

type Journey = "customer" | "provider" | "both";

const journeyOptions: Array<{
  value: Journey;
  label: string;
  description: string;
}> = [
  {
    value: "customer",
    label: "I need a service",
    description: "Book help for repairs, installs, maintenance, or household jobs.",
  },
  {
    value: "provider",
    label: "I offer services",
    description: "Join as a service provider and start getting matched to work.",
  },
  {
    value: "both",
    label: "I do both",
    description: "Useful if you sometimes need help and also take on paid jobs.",
  },
];

export function WaitlistForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [journey, setJourney] = useState<Journey>("customer");
  const [city, setCity] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [message, setMessage] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "success" || !whatsappUrl) return;

    const timer = window.setTimeout(() => {
      window.location.assign(whatsappUrl);
    }, 700);

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
          name,
          phone,
          journey,
          city,
          serviceCategory,
          businessName: businessName || undefined,
          message: message || undefined,
          whatsappOptIn,
          source: "/waitlist",
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
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-green-wa)]">
          Registration saved
        </p>
        <h3 className="mt-3 text-2xl font-semibold">You&apos;re in.</h3>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          We&apos;ve saved your details and we&apos;re opening WhatsApp next so the onboarding conversation can continue there.
        </p>
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-full bg-[color:var(--accent-green-wa)] px-4 text-sm font-medium text-white transition-colors hover:bg-[color:var(--accent-green-wa)]/90"
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            Continue on WhatsApp
          </a>
        ) : null}
        <button
          type="button"
          className="mt-4 text-sm font-medium text-foreground underline underline-offset-4"
          onClick={() => {
            setStatus("idle");
            setWhatsappUrl(null);
          }}
        >
          Register another number
        </button>
      </div>
    );
  }

  const serviceLabel =
    journey === "provider"
      ? "Main service you offer"
      : journey === "both"
        ? "Main service you offer or need"
        : "Service you need";

  const noteLabel =
    journey === "provider"
      ? "Skills, availability, or areas you cover"
      : "Short note about the job or support you need";

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

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="onboarding-name" className="mb-1.5 block text-sm font-medium">
            Full name
          </label>
          <Input
            id="onboarding-name"
            type="text"
            placeholder="Your name and surname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={status === "loading"}
          />
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
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="onboarding-city" className="mb-1.5 block text-sm font-medium">
            Area or suburb
          </label>
          <Input
            id="onboarding-city"
            type="text"
            placeholder="Johannesburg South, Midrand, Pretoria East"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
            disabled={status === "loading"}
          />
        </div>
        <div>
          <label htmlFor="onboarding-service" className="mb-1.5 block text-sm font-medium">
            {serviceLabel}
          </label>
          <Input
            id="onboarding-service"
            type="text"
            placeholder={journey === "provider" ? "Electrical, plumbing, carpentry" : "Plumbing, painting, appliance repair"}
            value={serviceCategory}
            onChange={(e) => setServiceCategory(e.target.value)}
            required
            disabled={status === "loading"}
          />
        </div>
      </div>

      {journey !== "customer" ? (
        <div>
          <label htmlFor="onboarding-business" className="mb-1.5 block text-sm font-medium">
            Business name
            <span className="ml-2 text-xs font-normal text-muted-foreground">Optional</span>
          </label>
          <Input
            id="onboarding-business"
            type="text"
            placeholder="Business or trading name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            disabled={status === "loading"}
          />
        </div>
      ) : null}

      <div>
        <label htmlFor="onboarding-message" className="mb-1.5 block text-sm font-medium">
          {noteLabel}
        </label>
        <Textarea
          id="onboarding-message"
          rows={4}
          placeholder={
            journey === "provider"
              ? "Tell us the jobs you do, tools you have, and when you are available."
              : "Tell us what you need done and anything important we should know."
          }
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={status === "loading"}
        />
      </div>

      <label className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3">
        <input
          type="checkbox"
          checked={whatsappOptIn}
          onChange={(e) => setWhatsappOptIn(e.target.checked)}
          disabled={status === "loading"}
          className="mt-1 h-4 w-4 rounded border-border text-[color:var(--accent-green-wa)] focus:ring-[color:var(--accent-green-wa)]"
        />
        <span className="text-sm leading-6 text-muted-foreground">
          Use this number for WhatsApp onboarding and service-related updates.
        </span>
      </label>

      <FormFeedback
        status={status}
        successMessage="Saved successfully."
        errorMessage={errorMessage}
      />

      <Button type="submit" disabled={status === "loading"} className="h-12 w-full rounded-full text-base">
        {status === "loading" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving details...
          </>
        ) : (
          <>
            Save and continue on WhatsApp
            <MessageCircle className="ml-2 h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}
