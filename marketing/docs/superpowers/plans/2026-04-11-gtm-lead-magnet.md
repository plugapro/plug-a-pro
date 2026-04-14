# Go-To-Market: Lead Magnet Capture + Content Asset Library

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a WhatsApp-first lead magnet capture system in the marketing site, and organise all campaign content assets as execution-ready files for the 90-day go-to-market plan.

**Architecture:** Extend the existing `/api/leads` route with a `lead_magnet` type that captures a phone number, records the lead in `marketing_leads`, and returns a WhatsApp deep-link with a prefill message. Add a `/free-templates` landing page using the same OnboardingForm pattern already established. All content assets (post drafts, ad copy, platform setup guides, KPI dashboard) are created as markdown files in `docs/marketing/` for human execution.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, Supabase, Tailwind CSS, shadcn/ui, Vitest

**LinkedIn is paused.** Do not create any LinkedIn-related content files or components. Focus is Facebook, Instagram, WhatsApp, and Google Business Profile.

---

## File Map

### New files
| File | Purpose |
|---|---|
| `marketing/app/(marketing)/free-templates/page.tsx` | `/free-templates` landing page |
| `marketing/components/marketing/LeadMagnetForm.tsx` | Phone capture form — lead magnet variant |
| `marketing/supabase/migrations/003_lead_magnet_type.sql` | Add `lead_magnet` to DB type constraint |
| `marketing/__tests__/api/lead-magnet.test.ts` | Tests for the `lead_magnet` API path (separate file — vi.mock is hoisted; adding to existing test file would break it) |
| `docs/marketing/facebook-posts.md` | All 12 Facebook post drafts |
| `docs/marketing/instagram-captions.md` | All 12 Instagram caption drafts |
| `docs/marketing/ad-copy.md` | 6 static ad concepts + 6 click-to-WhatsApp copy variations |
| `docs/marketing/video-scripts.md` | 6 short-form video script ideas |
| `docs/marketing/platform-setup/whatsapp-business.md` | WhatsApp Business setup checklist + copy |
| `docs/marketing/platform-setup/facebook-page.md` | Facebook Page setup checklist + copy |
| `docs/marketing/platform-setup/instagram.md` | Instagram Business setup checklist + copy |
| `docs/marketing/platform-setup/google-business.md` | Google Business Profile setup checklist + copy |
| `docs/marketing/lead-magnets/whatsapp-template-pack.md` | Full content of the template pack lead magnet |
| `docs/marketing/lead-magnets/dispatch-checklist.md` | Full content of the dispatch checklist lead magnet |
| `docs/marketing/lead-magnets/cashflow-tracker.md` | Cash flow tracker structure and instructions |
| `docs/marketing/kpi-dashboard.md` | Weekly + monthly KPI definitions and dashboard formulas |
| `docs/marketing/content-calendar-12-week.md` | Full 12-week content calendar |

### Modified files
| File | Change |
|---|---|
| `marketing/app/api/leads/route.ts` | Add `leadMagnetSchema` + handler branch (lines 1–110 area) |
| `marketing/lib/analytics.ts` | Add `leadMagnetDownload` event |

---

## Task 1: Supabase migration — add `lead_magnet` type

**Files:**
- Create: `marketing/supabase/migrations/003_lead_magnet_type.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 003_lead_magnet_type.sql
-- Extend marketing_leads type constraint to include lead_magnet captures.

alter table marketing_leads
  drop constraint if exists marketing_leads_type_check;

alter table marketing_leads
  add constraint marketing_leads_type_check
  check (type in ('waitlist', 'contact', 'chat', 'onboarding', 'lead_magnet'));
```

- [ ] **Step 2: Apply migration to local Supabase**

Run: `cd marketing && npx supabase db push` (or `npx supabase migration up` if using local dev)

Expected: Migration applies cleanly, no errors about existing rows (the new value is additive).

- [ ] **Step 3: Commit**

```bash
git add marketing/supabase/migrations/003_lead_magnet_type.sql
git commit -m "chore(marketing-db): add lead_magnet to marketing_leads type constraint"
```

---

## Task 2: Extend leads API — add `lead_magnet` schema + handler

**Files:**
- Modify: `marketing/app/api/leads/route.ts`

The existing file has `contactSchema`, `onboardingSchema`, and a `schema` discriminated union. Read the full current file before editing. The `normalizePhone` and `phoneRegex` helpers are already defined — reuse them.

- [ ] **Step 1: Read the current file**

```bash
cat marketing/app/api/leads/route.ts
```

- [ ] **Step 2: Add `leadMagnetSchema` after `onboardingSchema`**

Find this block (after `onboardingSchema`):

```typescript
const schema = z.discriminatedUnion("type", [contactSchema, onboardingSchema]);
```

Replace with:

```typescript
const leadMagnetSchema = baseSchema.extend({
  type: z.literal("lead_magnet"),
  phone: z
    .string()
    .trim()
    .min(8)
    .max(20)
    .refine((value) => phoneRegex.test(normalizePhone(value)), {
      message: "Enter a valid mobile number.",
    }),
  magnet: z.enum(["template-pack", "dispatch-checklist", "cashflow-tracker"]),
});

const schema = z.discriminatedUnion("type", [
  contactSchema,
  onboardingSchema,
  leadMagnetSchema,
]);
```

- [ ] **Step 3: Add the lead_magnet insert + response branch inside `POST`**

Find this block at the end of `POST` (before the final `return NextResponse.json({ success: true })`):

```typescript
  if (result.data.type === "onboarding") {
    return NextResponse.json({
      success: true,
      whatsappUrl: buildWhatsAppLink(journeyPrefill[result.data.journey]),
    });
  }

  return NextResponse.json({ success: true });
```

Replace with:

```typescript
  if (result.data.type === "onboarding") {
    return NextResponse.json({
      success: true,
      whatsappUrl: buildWhatsAppLink(journeyPrefill[result.data.journey]),
    });
  }

  if (result.data.type === "lead_magnet") {
    return NextResponse.json({
      success: true,
      whatsappUrl: buildWhatsAppLink(magnetPrefill[result.data.magnet]),
    });
  }

  return NextResponse.json({ success: true });
```

- [ ] **Step 4: Add `magnetPrefill` map near `journeyPrefill` (after it)**

Find:
```typescript
const journeyPrefill: Record<string, string> = {
  customer: "Hi, I want to register as a customer and book services through Plug-A-Pro.",
  provider: "Hi, I want to join Plug-A-Pro as a service provider.",
  both: "Hi, I want to join Plug-A-Pro as both a customer and service provider.",
};
```

Add immediately after:
```typescript
const magnetPrefill: Record<string, string> = {
  "template-pack": "Hi ServiceMen, I'd like the free WhatsApp template pack please.",
  "dispatch-checklist": "Hi ServiceMen, I'd like the free dispatch checklist please.",
  "cashflow-tracker": "Hi ServiceMen, I'd like the free cash flow tracker please.",
};
```

- [ ] **Step 5: Handle `lead_magnet` insert inside the shared insert block**

The existing insert uses a conditional. Find:

```typescript
  const { error } = await supabase
    .from("marketing_leads")
    .insert(
      result.data.type === "onboarding"
        ? {
            type: result.data.type,
            phone: normalizedPhone,
            ...
          }
        : { ...result.data, venture: siteConfig.venture }
    );
```

Replace the ternary with a helper object so `lead_magnet` inserts correctly:

```typescript
  const insertPayload =
    result.data.type === "onboarding"
      ? {
          type: result.data.type,
          phone: normalizedPhone,
          journey: result.data.journey,
          message: result.data.message,
          source: result.data.source,
          venture: siteConfig.venture,
          whatsapp_opt_in: true,
        }
      : result.data.type === "lead_magnet"
      ? {
          type: result.data.type,
          phone: normalizePhone(result.data.phone),
          name: result.data.name,
          source: result.data.source ?? `lead-magnet/${result.data.magnet}`,
          message: result.data.magnet,
          venture: siteConfig.venture,
          whatsapp_opt_in: true,
        }
      : { ...result.data, venture: siteConfig.venture };

  const { error } = await supabase.from("marketing_leads").insert(insertPayload);
```

Also update `normalizedPhone` declaration to remain scoped to onboarding only (it already is — just ensure `lead_magnet` does not reference it):

```typescript
  const normalizedPhone =
    result.data.type === "onboarding"
      ? normalizePhone(result.data.phone)
      : undefined;
```

This is already correct in the current file — no change needed there.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd marketing && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add marketing/app/api/leads/route.ts
git commit -m "feat(marketing-api): add lead_magnet type to leads route"
```

---

## Task 3: Add `leadMagnetDownload` analytics event

**Files:**
- Modify: `marketing/lib/analytics.ts`

- [ ] **Step 1: Add the event after `whatsappClick`**

Find:
```typescript
  /** WhatsApp chat link clicked */
  whatsappClick(source: string) {
    track("whatsapp_click", { source });
  },
```

Add after:
```typescript
  /** Lead magnet form submitted — phone captured, WhatsApp handoff triggered */
  leadMagnetDownload(magnet: "template-pack" | "dispatch-checklist" | "cashflow-tracker", source: string) {
    track("lead_magnet_download", { magnet, source });
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd marketing && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add marketing/lib/analytics.ts
git commit -m "feat(marketing-analytics): add leadMagnetDownload event"
```

---

## Task 4: Tests for `lead_magnet` API path

**Files:**
- Create: `marketing/__tests__/api/lead-magnet.test.ts`

> **Why a new file:** `vi.mock()` calls are hoisted to the top of each module. The existing `leads.test.ts` already has its own `vi.hoisted` block — adding new mocks there would silently break existing tests. Always put new mocks in a new test file.

- [ ] **Step 1: Write the test file**

```typescript
// __tests__/api/lead-magnet.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/leads/route";

const { marketingInsertMock, fromMock } = vi.hoisted(() => ({
  marketingInsertMock: vi.fn().mockResolvedValue({ error: null }),
  fromMock: vi.fn(() => ({
    insert: marketingInsertMock,
  })),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: fromMock },
}));

function makeRequest(body: unknown, ip = "127.0.0.1"): Request {
  return new Request("http://localhost/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/leads — lead_magnet type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    marketingInsertMock.mockResolvedValue({ error: null });
  });

  it("returns 200 and a WhatsApp URL for template-pack magnet", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "template-pack",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.whatsappUrl).toContain("wa.me");
    expect(json.whatsappUrl).toContain("template");
  });

  it("returns 200 and a WhatsApp URL for dispatch-checklist magnet", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "dispatch-checklist",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.whatsappUrl).toContain("checklist");
  });

  it("returns 200 and a WhatsApp URL for cashflow-tracker magnet", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "cashflow-tracker",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.whatsappUrl).toContain("cash+flow");
  });

  it("inserts into marketing_leads with type lead_magnet", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "template-pack",
    });
    await POST(req);
    expect(fromMock).toHaveBeenCalledWith("marketing_leads");
    const insertArg = marketingInsertMock.mock.calls[0]?.[0];
    expect(insertArg).toMatchObject({
      type: "lead_magnet",
      phone: "+27821234567",
      whatsapp_opt_in: true,
    });
  });

  it("normalises SA local format phone number", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "0821234567",
      magnet: "template-pack",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const insertArg = marketingInsertMock.mock.calls[0]?.[0];
    expect(insertArg.phone).toBe("+27821234567");
  });

  it("accepts optional name field", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "template-pack",
      name: "Thabo",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const insertArg = marketingInsertMock.mock.calls[0]?.[0];
    expect(insertArg.name).toBe("Thabo");
  });

  it("rejects missing phone", async () => {
    const req = makeRequest({ type: "lead_magnet", magnet: "template-pack" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects missing magnet", async () => {
    const req = makeRequest({ type: "lead_magnet", phone: "+27821234567" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects invalid magnet value", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "nonexistent-thing",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("does NOT insert into onboarding_intakes", async () => {
    const req = makeRequest({
      type: "lead_magnet",
      phone: "+27821234567",
      magnet: "template-pack",
    });
    await POST(req);
    const tablesCalled = fromMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(tablesCalled).not.toContain("onboarding_intakes");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (API not yet wired — if Task 2 is done, they should pass)**

```bash
cd marketing && npx vitest run __tests__/api/lead-magnet.test.ts
```

Expected: All 9 tests pass. If any fail, debug the route handler changes from Task 2.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
cd marketing && npx vitest run
```

Expected: All existing tests still pass, 9 new tests pass.

- [ ] **Step 4: Commit**

```bash
git add marketing/__tests__/api/lead-magnet.test.ts
git commit -m "test(marketing-api): lead_magnet endpoint tests"
```

---

## Task 5: `LeadMagnetForm` component

**Files:**
- Create: `marketing/components/marketing/LeadMagnetForm.tsx`

Follows the exact same pattern as `OnboardingForm`. No journey selector. Accepts `magnet` as a prop. On success: opens WhatsApp (1.5 s delay with manual fallback link).

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormFeedback } from "@/components/shared/FormFeedback";
import { analytics } from "@/lib/analytics";

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
        body: JSON.stringify({ type: "lead_magnet", phone, name: name || undefined, magnet, source }),
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
          Your number is saved. WhatsApp should open automatically — if it doesn&apos;t, tap below.
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd marketing && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add marketing/components/marketing/LeadMagnetForm.tsx
git commit -m "feat(marketing): LeadMagnetForm component — phone capture with WhatsApp handoff"
```

---

## Task 6: `/free-templates` landing page

**Files:**
- Create: `marketing/app/(marketing)/free-templates/page.tsx`

This is a Server Component — no `"use client"` directive. The form is the only interactive part and is already a Client Component.

- [ ] **Step 1: Write the page**

```tsx
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/metadata";
import { LeadMagnetForm } from "@/components/marketing/LeadMagnetForm";

export const metadata: Metadata = buildMetadata({
  title: "Free WhatsApp Template Pack for Service Businesses",
  description:
    "5 ready-to-use WhatsApp message templates for SA service businesses — quote, booking confirmation, technician dispatched, job complete, and payment request. Free.",
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
    preview: "Hi [Name], your booking is confirmed for [date] between [time window]. Your technician will be [name].",
  },
  {
    title: "Technician on the way",
    preview: "Hi [Name], your technician [name] is on the way and should arrive in approximately [X] minutes.",
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
            WhatsApp Template Pack for Service Businesses
          </h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground">
            5 ready-to-use WhatsApp messages for every stage of a service job. Copy, paste, and send.
            Built for South African service businesses with 3–15 technicians.
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
                A one-page printable checklist for service team managers to run every morning before dispatching technicians.
              </p>
              <a
                href={`https://wa.me/276935524470?text=${encodeURIComponent("Hi ServiceMen, I'd like the free dispatch checklist please.")}`}
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
                href={`https://wa.me/27693552447?text=${encodeURIComponent("Hi ServiceMen, I'd like the free cash flow tracker please.")}`}
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd marketing && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Run the dev server and manually test the page**

```bash
cd marketing && npm run dev
```

Open: `http://localhost:3000/free-templates`

Check:
- Page renders without errors
- Form submits with a valid SA number and `magnet: template-pack`
- Success state shows "Opening WhatsApp…" and a manual fallback link
- WhatsApp URL contains the correct prefill text

- [ ] **Step 4: Run full test suite**

```bash
cd marketing && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add marketing/app/(marketing)/free-templates/page.tsx
git commit -m "feat(marketing): /free-templates lead magnet landing page"
```

---

## Task 7: Content asset library — docs/marketing/

All files below are execution-ready markdown documents for the founder to use when posting. LinkedIn is excluded (paused). Create each file exactly as specified.

**Files:** Create all files in the project root `docs/marketing/` (not inside `marketing/`).

- [ ] **Step 1: Create `docs/marketing/facebook-posts.md`**

Content: All 12 Facebook post drafts from the GTM strategy. Format each as:

```markdown
# Facebook Posts — ServiceMen App

> Platform: Facebook Page
> Cadence: 3x per week
> Goal: Awareness → Trust → Lead generation (in that order across the 12-week plan)

---

## Post 1 — Week 1 | Awareness | The Problem

> 🔧 Honest question for service business owners in Gauteng:
>
> How many WhatsApp messages do you send before a job is actually booked and confirmed?
>
> For most businesses we've spoken to, it's 12–20 messages just to confirm one appointment.
>
> There's a better way. Comment below or WhatsApp us to see it.
> [WhatsApp link]

**Asset needed:** None — text only
**CTA:** Comment / WhatsApp link

---

## Post 2 — Week 1 | Awareness | Product intro

> If your "dispatch system" is a WhatsApp group and your "invoicing system" is a photo of a handwritten job sheet — we built ServiceMen for you.
>
> South African field service platform. WhatsApp-first. Built for teams of 3–15 technicians.
>
> Plumbers, electricians, appliance repair, aircon service, pest control, cleaning — if you send technicians to customers, we can help.
>
> WhatsApp us to see how it works 👇 [link]

**Asset needed:** Brand image or product screenshot
**CTA:** WhatsApp link

---

## Post 3 — Week 2 | Trust | Feature — customer updates

> The question we hear most from service business owners:
>
> "How do I stop customers calling me to ask where the technician is?"
>
> Answer: you send them a WhatsApp update before they need to ask.
>
> Job confirmed ✅
> Technician dispatched ✅
> Technician on the way ✅
> Job complete — invoice attached ✅
>
> ServiceMen sends all of these automatically. Your customers stay informed. Your phone stops ringing for updates.
>
> See how it works: [WhatsApp link]

**Asset needed:** WhatsApp message screenshot mockup
**CTA:** WhatsApp link

---

## Post 4 — Week 2 | Trust | Founder + SA-built

> We're a South African team building software for South African service businesses.
>
> We know what load shedding does to your scheduling. We know how WhatsApp-first your customers are. We know the difference between a Joburg market and what the generic American field service apps assume about your business.
>
> That's why we built ServiceMen. Not a localised version of something built for the US market. Built here, for here.
>
> Like our page for updates 👆

**Asset needed:** Team photo or SA-themed brand image
**CTA:** Like page

---

## Post 5 — Week 3 | Lead Gen | Lead magnet launch

> 🎁 Free for any SA service business owner:
>
> The ServiceMen WhatsApp Template Pack — 5 ready-to-use message templates:
>
> ✅ New job request acknowledgement
> ✅ Quote ready notification
> ✅ Booking confirmation
> ✅ Technician on the way
> ✅ Payment request after job
>
> Professional, clear, ready to copy and paste.
>
> WhatsApp us the word TEMPLATES and we'll send them through: [link]

**Asset needed:** Template pack preview graphic
**CTA:** WhatsApp link with TEMPLATES prefill

---

## Post 6 — Week 4 | Trust | Early social proof

> What our early users are saying after their first month on ServiceMen:
>
> "I used to spend the first 2 hours of every morning sorting out the day's jobs. Now I check the dashboard in 10 minutes." — Electrical contractor, Pretoria
>
> "My customers stopped complaining about communication. That alone was worth it." — Appliance repair business, Johannesburg
>
> "I collected 3 payments in one day that had been sitting for weeks. The system sent the reminders." — Plumbing business, Centurion
>
> Sound like something your business needs? WhatsApp us 👉 [link]

**Asset needed:** Quote graphic with branding
**CTA:** WhatsApp link

---

## Post 7 — Week 5 | How-To | End of day checklist

> The end-of-day checklist every service business owner should be running (but most aren't):
>
> ☐ All jobs for tomorrow confirmed with technicians?
> ☐ Any open quotes from the last 3 days without a response?
> ☐ Any invoices unpaid from the last 14 days?
> ☐ Any customer complaints or callbacks outstanding?
> ☐ Parts or equipment needed for tomorrow's jobs ordered?
>
> If this takes you more than 30 minutes, your system is doing too little work.
>
> ServiceMen handles most of this automatically. Want to see how?
> Comment DEMO and we'll set up a walkthrough.

**Asset needed:** Checklist graphic
**CTA:** Comment DEMO

---

## Post 8 — Week 6 | Feature | Job dispatch flow

> 📲 How job dispatch works in ServiceMen:
>
> 1. Customer request comes in
> 2. You assign it to the closest available technician (from your dashboard)
> 3. Technician gets the job details on WhatsApp
> 4. Customer gets a booking confirmation on WhatsApp
> 5. When the job is done — invoice sent, payment link attached
>
> No phone tag. No group chat chaos. No missed follow-ups.
>
> WhatsApp us to see it live: [link]

**Asset needed:** Flow diagram or short screen recording
**CTA:** WhatsApp link

---

## Post 9 — Week 7 | SA Pain | Load shedding

> Scenario: It's Tuesday morning. Load shedding just hit. You have 4 technicians on the road. A customer calls to cancel and reschedule. Another customer wants to know where their technician is.
>
> Your phone is blowing up. You're trying to update a spreadsheet that's now offline. The group chat is full of voice notes you haven't listened to.
>
> This is what ServiceMen was built for.
>
> WhatsApp us to see how it handles exactly this situation: [link]

**Asset needed:** None — text only
**CTA:** WhatsApp link

---

## Post 10 — Week 8 | Objection | Too small for software

> "Isn't this just for big companies?"
>
> No. The businesses that benefit most from ServiceMen are exactly at the stage where chaos starts:
> 3 technicians → you can still manage in your head
> 5 technicians → it starts breaking
> 8 technicians → it's costing you real money and customers
>
> We built this for 3–15. That's the zone. That's who we serve.
>
> If you're in that zone — WhatsApp us: [link]

**Asset needed:** None — text only or simple graphic
**CTA:** WhatsApp link

---

## Post 11 — Week 11 | Conversion | Founding 50 urgency

> ⏰ Founding 50 update:
>
> We opened early access to 50 service businesses in Gauteng. 38 spots are taken.
>
> What's included in the Founding 50:
> ✅ 3 months free
> ✅ Personal onboarding — we set it up with you
> ✅ Founding member pricing locked in
> ✅ Direct line to the product team
>
> 12 spots left. We're closing this cohort on [date].
>
> WhatsApp us if you want one: [link]

**Asset needed:** Deadline/urgency graphic
**CTA:** WhatsApp link

---

## Post 12 — Week 12 | Results | 90-day milestone

> 90 days. [X] service businesses. [X] jobs managed. [X] payments collected.
>
> ServiceMen is growing — and every business on the platform was running on WhatsApp group chats and spreadsheets before they signed up.
>
> If you haven't had a look yet — now's a good time.
>
> WhatsApp us: [link]

**Asset needed:** Stats/milestone graphic
**CTA:** WhatsApp link
```

- [ ] **Step 2: Create `docs/marketing/instagram-captions.md`**

```markdown
# Instagram Captions — ServiceMen App

> Platform: Instagram Business (@servicemenapp)
> Cadence: 3x per week from Week 3
> Format: Static graphic + caption, or Reel + caption
> Link in bio: WhatsApp link + lead magnet page

---

## Caption 1 — Week 3 | Awareness | Pain validation

Your phone is your CRM. Your WhatsApp is your dispatch system. Your brain is your scheduler.

Sound familiar? There's a better version of this.

ServiceMen — WhatsApp-first job management for SA service businesses.
Link in bio 👆

#fieldservice #southafrica #plumbing #electrician #servicebusiness #gauteng #businessowner

**Format:** Quote graphic
**Asset:** Text on dark background with ServiceMen branding

---

## Caption 2 — Week 3 | Awareness | Before/after

Before ServiceMen: 12 WhatsApp messages to book one job.
After ServiceMen: customer books, technician dispatched, confirmation sent — without you in the middle.

Built for SA service businesses with 3–15 technicians.
Link in bio to see how it works.

#servicebusiness #whatsapp #fieldservicemanagement #southafrica #plumber #electrician

**Format:** Two-panel static graphic
**Asset:** Before/after comparison

---

## Caption 3 — Week 4 | Lead Gen | Template pack

The 5 WhatsApp messages every service business should be sending (but most aren't):

1. "Thanks for reaching out, here's your quote"
2. "Your booking is confirmed for [date]"
3. "Your technician is on the way"
4. "Your job is complete, here's your invoice"
5. "Your payment has been received, thank you"

Free template pack — link in bio 👆

**Format:** Carousel (5 slides, one per template)
**Asset:** 5 slide carousel with template previews

---

## Caption 4 — Week 4 | Awareness | Customer calls

Customer: "Where's the technician?"
You: *scrolling WhatsApp trying to find the voice note with the job details*

This is fixable.

ServiceMen sends customers real-time updates via WhatsApp so they stop calling you.

Link in bio for a free walkthrough.

**Format:** Text-only or meme-style graphic
**Asset:** Relatable graphic or text on background

---

## Caption 5 — Week 5 | Awareness | Growth stages

3 technicians → you can manage it mentally
5 technicians → it starts breaking
8 technicians → you're losing jobs and money

The chaos doesn't mean you're bad at business.
It means you need the right system.

ServiceMen is built for exactly this stage.
Link in bio 👆

#smallbusiness #southafrica #servicebusiness #fieldservice

**Format:** Static graphic with numbers
**Asset:** Clean typographic graphic

---

## Caption 6 — Week 5 | Trust | SA-built

Built for South Africa.

We know load shedding disrupts your schedule.
We know WhatsApp is how your customers communicate.
We know the generic American field service apps don't fit how you work.

ServiceMen was built here. For here.

Link in bio to learn more.

**Format:** Static — SA flag / Joburg skyline visual
**Asset:** Brand image with SA reference

---

## Caption 7 — Week 6 | Lead Gen | Dispatch checklist

Free for any SA service business owner 👇

5 WhatsApp message templates:
✅ Quote ready
✅ Booking confirmed
✅ Technician dispatched
✅ Job complete
✅ Payment request

DM us TEMPLATES or grab the link in bio.

#freeresource #servicebusiness #southafrica #whatsapp

**Format:** Static graphic — template pack preview
**Asset:** Resource preview image

---

## Caption 8 — Week 7 | Trust | Day in the life

What a day in the life looks like for a ServiceMen user:

7am — check dashboard: 6 jobs for today, all confirmed
9am — new job request comes in, assigned in 2 clicks
12pm — customer gets automatic "technician on the way" update
4pm — job complete, invoice sent automatically
5pm — payment received, no chasing needed

What does your 5pm look like?

**Format:** Reel (30s) or text carousel
**Asset:** Screen recording or designed carousel

---

## Caption 9 — Week 8 | Trust | Operations insight

The best service businesses in SA aren't necessarily the ones with the best technicians.

They're the ones that respond fastest, communicate clearest, and collect payment cleanest.

Operations win customers. ServiceMen is your operations layer.

Link in bio.

**Format:** Quote graphic
**Asset:** Clean text graphic

---

## Caption 10 — Week 9 | Trust | Early case study

An electrical contractor in Randburg stopped losing jobs.

Not because he hired more staff. Not because he got better at sales.

Because customers stopped falling through the cracks when their quote sat unanswered for 4 days.

ServiceMen sent the follow-up automatically. They said yes.

Link in bio to see how.

**Format:** Story-style static or short Reel
**Asset:** Before/after or testimonial graphic

---

## Caption 11 — Week 11 | Conversion | Founding 50

⏰ Founding 50 — 12 spots left.

First 50 SA service businesses on ServiceMen get:
3 months free + hands-on onboarding + founding pricing locked in.

Closing [date].

Link in bio to grab a spot.

**Format:** Urgency static graphic
**Asset:** Counter/deadline graphic

---

## Caption 12 — Week 12 | Results | 90-day milestone

90 days. [X] businesses. [X] jobs managed.

From scattered WhatsApp threads to a real system.

This is just the start.

Link in bio to join us.

**Format:** Milestone stats graphic
**Asset:** Stats summary graphic
```

- [ ] **Step 3: Create `docs/marketing/ad-copy.md`**

```markdown
# Paid Ad Copy — ServiceMen App

> Platform: Facebook and Instagram
> Format A: Static image ads (awareness + retargeting)
> Format B: Click-to-WhatsApp ads (direct response)
> Launch: Month 2 (Days 31–60)
> Starting budget: R5,000–R8,000/month

---

## Static Ad Concepts (6)

### Ad S1 — Pain Point Split
**Headline:** Still managing 8 technicians in a WhatsApp group?
**Body:** There's a better version of this.
**Visual:** Split screen — chaotic WhatsApp group (left) vs clean ServiceMen dashboard (right)
**CTA button:** Send WhatsApp Message
**Placement:** Facebook Feed, Instagram Feed

---

### Ad S2 — Before/After
**Headline:** Before: 12 WhatsApp messages to book one job. After: automated.
**Body:** [no body copy — visual does the work]
**Visual:** Two-panel — cluttered chat thread (before) vs clean booking confirmation card (after)
**CTA button:** Learn More → links to /free-templates
**Placement:** Instagram Feed, Stories

---

### Ad S3 — Lead Magnet
**Headline:** Free: WhatsApp Template Pack for SA Service Businesses
**Body:** 5 ready-to-use messages your team should be sending — quote, booking, dispatch, job complete, payment. Free.
**Visual:** Template pack document preview
**CTA button:** Get Free Templates → links to /free-templates
**Placement:** Facebook Feed, Instagram Feed

---

### Ad S4 — Social Proof
**Headline:** [X] SA service businesses stopped managing jobs in WhatsApp group chats.
**Body:** Plumbers. Electricians. Appliance repair. Aircon service. They all switched.
**Visual:** Collage of business types with ServiceMen UI overlay
**CTA button:** Send WhatsApp Message
**Placement:** Facebook Feed

---

### Ad S5 — Founding 50 Urgency
**Headline:** Founding 50 — 12 spots left
**Body:** 3 months free. Personal onboarding. Founding pricing locked in.
**Visual:** Progress bar or counter showing "38/50 taken"
**CTA button:** Claim Your Spot → WhatsApp link
**Placement:** Facebook Feed, Instagram Feed, Stories

---

### Ad S6 — Feature Spotlight
**Headline:** Your customers stop asking "where's the technician?" when ServiceMen tells them automatically.
**Body:** Real-time job updates via WhatsApp. No calls. No chasing.
**Visual:** WhatsApp thread showing automated ServiceMen update message
**CTA button:** See How It Works → WhatsApp link
**Placement:** Facebook Feed, Instagram Feed

---

## Click-to-WhatsApp Ad Copy (6)

### Ad W1 — Direct pain
**Headline:** Running a service business in Gauteng?
**Body:** If you have 3–15 technicians and you're still managing bookings, dispatch, and payments on WhatsApp and spreadsheets — there's a system built for exactly your stage. Tap to see how ServiceMen works for your business.
**CTA button:** Send Message
**Prefill:** Hi ServiceMen, I run a service business and want to see how it works.

---

### Ad W2 — Lead magnet
**Headline:** Free: WhatsApp Template Pack for SA Service Businesses
**Body:** 5 message templates your team should be sending for every job — quote ready, booking confirmed, technician on the way, job complete, payment request. Tap to get them sent to you on WhatsApp.
**CTA button:** Send Message
**Prefill:** Hi ServiceMen, I'd like the free WhatsApp template pack please.

---

### Ad W3 — Social proof
**Headline:** [X] service businesses in Gauteng switched to ServiceMen.
**Body:** Plumbers. Electricians. Appliance repair shops. Aircon service companies. They all stopped managing jobs in WhatsApp group chats and spreadsheets. Tap to see what changed for them — and whether it applies to you.
**CTA button:** Send Message
**Prefill:** Hi ServiceMen, I want to know how other service businesses use this.

---

### Ad W4 — Objection handling
**Headline:** "We already use WhatsApp."
**Body:** So do all our customers. ServiceMen doesn't replace WhatsApp — it gives your WhatsApp a proper operations system behind it. Tap to see the difference in 10 minutes.
**CTA button:** Send Message
**Prefill:** Hi ServiceMen, I already use WhatsApp — want to see how yours is different.

---

### Ad W5 — Founding 50 offer
**Headline:** Founding 50 — Join the first 50 service businesses on ServiceMen.
**Body:** First 50 businesses get 3 months free + hands-on onboarding + founding pricing locked forever. Tap to grab one of the 12 remaining spots.
**CTA button:** Send Message
**Prefill:** Hi ServiceMen, I want to join the Founding 50.

---

### Ad W6 — Vertical specific (Plumbing)
**Headline:** Running a plumbing business with a team of technicians?
**Body:** Quotes unanswered. Technicians double-booked. Customers calling to ask where the team is. ServiceMen was built for exactly this. Tap to see a 10-minute walkthrough built around your specific workflow.
**CTA button:** Send Message
**Prefill:** Hi ServiceMen, I run a plumbing business and want to see how it works.

---

## Creative Testing Plan

| Test | Variable | Kill threshold |
|---|---|---|
| Round 1 | Headline A (pain) vs Headline B (lead magnet) | Kill at R500 spend if CPL > R300 |
| Round 2 | Template pack offer vs demo offer | Kill loser at R1,000 spend |
| Round 3 | Vertical-specific (plumbing) vs generic | Kill at R500 spend if CPL > R300 |
| Round 4 | Scale winner for full month | Reassess creative after 30 days |

Audience: Gauteng, age 28–55, interests: plumbing, electrical, HVAC, business management, small business
```

- [ ] **Step 4: Create `docs/marketing/video-scripts.md`**

```markdown
# Short-Form Video Scripts — ServiceMen App

> Platform: Instagram Reels, Facebook Video
> Length: 20–60 seconds each
> Format: Screen recordings + voiceover, or talking-head founder clips
> Priority: Start with Script 1 and 2 — highest conversion potential

---

## Script 1 — "The WhatsApp Problem" (30 seconds)

**Hook (0–3s):** "This is how most service businesses in South Africa manage 8 technicians."

**Show (3–12s):** Screen recording of a chaotic WhatsApp group — multiple voice notes, unread messages, no structure, customer questions going unanswered.

**Narration (3–12s):** "Customer requests come in on personal numbers. Jobs get assigned in group chats. Quotes get sent and forgotten. Payments get chased weeks later."

**Pivot (12–20s):** "This is what it looks like on ServiceMen."

**Show (12–20s):** Clean dashboard — job request comes in, assigned to technician, customer gets WhatsApp update automatically, invoice sent.

**Close (25–30s):** "Same WhatsApp. Better system. Link in bio."

**Asset needed:** Screen recording of both states (chaotic vs ServiceMen). Voiceover or on-screen text.

---

## Script 2 — "Day in the Life" (45 seconds)

**Hook (0–3s):** "A typical Tuesday for a 6-technician plumbing business — before and after ServiceMen."

**Before section (3–20s):**
- 7am: phone ringing, WhatsApp group chaos, voice notes piling up
- 9am: spreadsheet open, trying to figure out who goes where
- 12pm: customer calls — "where's my technician?"
- 4pm: job done, invoice still not sent

**After section (20–40s):**
- 7am: dashboard check — 6 jobs confirmed, technicians briefed via WhatsApp
- 9am: new request comes in, assigned in 2 taps
- 12pm: customer already got "technician on the way" update
- 4pm: job complete, invoice sent automatically

**Close (40–45s):** "Which Tuesday do you want? Link in bio."

**Asset needed:** Split-screen or quick-cut editing. Can be text-only slides with voiceover if video not available.

---

## Script 3 — "The 5 Templates" (30 seconds)

**Hook (0–3s):** "5 WhatsApp messages every service business should be sending — but most aren't."

**Walk through (3–25s):** Show each template on screen as text:
1. Job request acknowledgement
2. Quote ready
3. Booking confirmed
4. Technician on the way
5. Payment request

**Close (25–30s):** "Free template pack. Link in bio or DM TEMPLATES."

**Asset needed:** Clean text slides or animated text on brand colours.

---

## Script 4 — "Founder Story" (60 seconds)

**Hook (0–5s):** "I spent 6 months talking to service business owners before I built anything."

**Story (5–45s) — talking head:**
- "Every single conversation sounded the same."
- "Too many customers to manage on a phone. Too many technicians to track in a group chat. Too much money stuck in unpaid invoices."
- "And every time I asked what software they used — 'WhatsApp and spreadsheets.'"
- "Not because they were behind. Because nothing was built for how they actually work."
- "So we built ServiceMen. WhatsApp-first. Built for South Africa. Built for the 3-to-15 technician business."

**Close (45–60s):** "If this sounds like your business — link in bio. Or just WhatsApp us directly."

**Asset needed:** Founder on camera, well-lit, casual. 60 seconds max.

---

## Script 5 — "Load Shedding" (30 seconds)

**Hook (0–3s):** "Load shedding shouldn't be killing your service business. But for some of you — it is."

**Problem (3–15s):**
- "Scheduling breaks when the office goes dark."
- "Technicians unreachable. Customers rescheduling by call."
- "Job sheets on a laptop that's now dead."

**Solution (15–25s):**
- "ServiceMen runs on mobile."
- "Updates go via WhatsApp — always on."
- "Your team stays coordinated even when the power isn't."

**Close (25–30s):** "Built for SA. Link in bio."

**Asset needed:** Text slides or screen recording. Load shedding visual context (candles, inverter, etc) optional.

---

## Script 6 — "Objection Crusher" (30 seconds)

**Hook (0–3s):** "I hear this all the time: 'We already use WhatsApp, we don't need software.'"

**Counter (3–20s):**
- "You're right. You use WhatsApp."
- "But you can't search jobs by status in WhatsApp."
- "You can't see which technician is closest in WhatsApp."
- "You can't automatically follow up on a quote in WhatsApp."
- "ServiceMen doesn't replace WhatsApp — it gives your WhatsApp a system behind it."

**Show (20–27s):** Quick screen recording of job search, dispatch view, automated follow-up.

**Close (27–30s):** "WhatsApp us to see how. Link in bio."

**Asset needed:** Talking head or text-on-screen + screen recording hybrid.
```

- [ ] **Step 5: Create `docs/marketing/platform-setup/whatsapp-business.md`**

```markdown
# WhatsApp Business Setup — ServiceMen App

## Account Setup

- [ ] Create WhatsApp Business account on a dedicated business number (not founder's personal number)
- [ ] Business name: **ServiceMen App**
- [ ] Business category: Technology
- [ ] Upload logo as profile picture (min 192x192px, no white border)
- [ ] Set business hours: Mon–Fri 07:00–18:00, Sat 08:00–13:00 SAST

## Profile Copy

**Short description (used in business profile, max ~150 chars):**
> WhatsApp-first job management for service businesses. Bookings, dispatch, updates, and payments — all in one.

**Business description (longer profile text):**
> ServiceMen helps South African service businesses with 3–15 technicians run their operations without the chaos of scattered calls, WhatsApp group chats, and spreadsheets.
>
> We built a WhatsApp-first job management platform for plumbers, electricians, appliance repair shops, aircon service companies, pest control, and maintenance teams.
>
> Built in South Africa, for South Africa.

## Greeting Message (new contacts)

> Hi, thanks for reaching out to ServiceMen App. We help service businesses in SA run bookings, dispatch, and payments through WhatsApp.
>
> Reply with:
> DEMO — to book a 30-min walkthrough
> TEMPLATES — to get our free WhatsApp template pack
> PRICING — to see our plans
>
> We'll reply within a few hours during business hours.

## Away Message (out of hours)

> Hi, we're currently out of the office (back Mon–Fri from 7am SAST).
>
> Reply with DEMO, TEMPLATES, or PRICING and we'll pick it up first thing in the morning.

## Quick Replies

| Shortcut | Response |
|---|---|
| /demo | "We'd love to show you ServiceMen. What does your team look like — how many technicians, and what kind of work do you do?" |
| /templates | "Sending you the free WhatsApp Template Pack now. 5 ready-to-use messages for your service jobs." |
| /pricing | "Our pricing is based on team size. For a 3–15 technician business, plans start from [R amount]/month. Want to talk through what fits your setup?" |
| /thanks | "Appreciate it! Let us know anytime you need help. 🙌" |

## WhatsApp Business API

- [ ] Apply for access via Meta Business Suite
- [ ] Register business number with WhatsApp Business Platform
- [ ] Set up wa.me/[number] short link
- [ ] Generate QR code for physical materials and digital profiles

## wa.me Link Formats

Direct link (no prefill): `https://wa.me/27693552447`
With prefill: `https://wa.me/27693552447?text=Hi+ServiceMen%2C+I+want+to+see+a+demo`
DEMO: `https://wa.me/27693552447?text=DEMO`
TEMPLATES: `https://wa.me/27693552447?text=TEMPLATES`
```

- [ ] **Step 6: Create `docs/marketing/platform-setup/facebook-page.md`**

```markdown
# Facebook Page Setup — ServiceMen App

## Page Creation

- [ ] Create Facebook Page as Business/Brand (not personal profile)
- [ ] Page name: **ServiceMen App**
- [ ] Category: Software / Business Software
- [ ] Upload logo (180x180px minimum)
- [ ] Design and upload cover image (820x312px)
- [ ] Set CTA button: **Send WhatsApp Message** (link to wa.me)
- [ ] Connect to Meta Business Suite

## Cover Banner

**Headline:** Run Your Service Business — Not the Other Way Around
**Subheadline:** WhatsApp-first job management for service teams in South Africa

## Short Description (shows under page name)

> WhatsApp-first job management for South African service businesses with 3–15 technicians.

## Long Description (About section)

> ServiceMen App helps South African service businesses stop running operations from scattered phone calls, WhatsApp group chats, and spreadsheets.
>
> We built a WhatsApp-first job management platform for businesses with 3 to 15 technicians — plumbers, electricians, appliance repair shops, aircon service companies, pest control, and maintenance teams.
>
> The problem we solve: too many customer requests handled manually, slow quote turnaround, missed bookings, no dispatch visibility, customers asking where their technician is, and poor payment collection.
>
> With ServiceMen, a customer request becomes a quote, a booking, a dispatched job, a status update to the customer, and a collected payment — without your team touching a spreadsheet or sending individual WhatsApp messages.
>
> Starting in Gauteng. Built for the South African market.

## Services Section

Add these as services:
- Job Request Management
- Technician Dispatch
- Customer WhatsApp Updates
- Invoicing and Payment Collection
- Quote Management

## Pinned Post

> Welcome to ServiceMen App.
>
> If you run a service business with a team of technicians — plumbing, electrical, appliance repair, aircon, pest control, cleaning — you know the chaos.
>
> Customers calling your personal number. Quotes going unanswered. Technicians showing up to the wrong address. Payments collected in cash with no record.
>
> We built ServiceMen to fix that. WhatsApp-first, built for South Africa, built for teams of 3 to 15.
>
> WhatsApp us to see how it works for your specific business: [wa.me link]
>
> Or download our free WhatsApp template pack for service businesses: [free-templates link]

## Messaging Auto-Response

**Instant reply (within 1 min):**
> Thanks for reaching out. We'll reply as soon as we can — usually within a few hours.
>
> In the meantime, you can WhatsApp us directly: [wa.me link]

## Setup Checklist

- [ ] Enable page reviews
- [ ] Add website URL
- [ ] Add WhatsApp number as contact method
- [ ] Connect Instagram Business account
- [ ] Set up Meta Business Suite for ads access
- [ ] Join 5 Facebook Groups:
  - SA Plumbers and Plumbing Professionals
  - Electrical Contractors South Africa
  - SA Small Business Network
  - Gauteng Business Owners
  - SA Service Business Owners (create if doesn't exist)
```

- [ ] **Step 7: Create `docs/marketing/platform-setup/instagram.md`**

```markdown
# Instagram Business Setup — ServiceMen App

## Account Setup

- [ ] Convert to Business account (Settings → Account → Switch to Professional)
- [ ] Category: Software
- [ ] Username: **@servicemenapp**
- [ ] Display name: ServiceMen App
- [ ] Upload logo as profile picture
- [ ] Connect to Facebook Page

## Bio (150 chars max)

> WhatsApp-first job management for SA service businesses 🔧
> Bookings · Dispatch · Payments
> Built for teams of 3–15 in Gauteng
> 👇 Free templates + demo

## Link in Bio

Use a single landing page or Linktree with:
1. "Book a free 30-min walkthrough" → wa.me link
2. "Get the free WhatsApp template pack" → /free-templates page
3. "See pricing" → website pricing page

## Contact Buttons

- [ ] Add Email button
- [ ] Add WhatsApp / Call button linked to business WhatsApp number

## Story Highlights (create before publishing)

| Highlight | Content |
|---|---|
| HOW IT WORKS | Product walkthrough screenshots/Reels |
| CUSTOMER STORIES | Testimonials and case study snippets |
| TEMPLATE PACK | Lead magnet preview + link |
| PRICING | Tier overview |

## 9-Post Grid (prepare before going public)

Prepare 9 posts in advance so the grid looks intentional when launched:

1. Brand introduction static
2. Pain point quote graphic
3. Feature — customer updates
4. Before/after graphic
5. Template pack lead magnet
6. How it works carousel (3 slides)
7. Social proof quote
8. Load shedding SA pain point
9. Founding 50 offer

## Posting Cadence (from Week 3)

- 3x per week
- Best times for SA B2B: Tue/Thu/Fri 07:00–09:00 or 12:00–13:00 SAST
- Mix: 2 static + 1 Reel per week minimum
```

- [ ] **Step 8: Create `docs/marketing/platform-setup/google-business.md`**

```markdown
# Google Business Profile Setup — ServiceMen App

## Account Setup

- [ ] Go to business.google.com and create or claim profile
- [ ] Business name: **ServiceMen App**
- [ ] Category: Software Company
- [ ] Service area: Gauteng, South Africa
- [ ] Phone: [business WhatsApp number]
- [ ] Website: plugapro.co.za
- [ ] Submit for verification (postcard or phone verification)

## Business Description (max 750 chars)

> ServiceMen App is a WhatsApp-first job management platform for South African service businesses. We help owner-led businesses with 3 to 15 technicians manage job requests, quoting, scheduling, technician dispatch, customer updates, invoicing, and payment collection — all in one system built for how SA businesses actually work.
>
> Serving service businesses in Gauteng — plumbers, electricians, appliance repair, aircon service, pest control, cleaning, and maintenance teams.

## Products to Add

- ServiceMen Starter (list tier/price when set)
- ServiceMen Pro (list tier/price when set)

## Services to Add

- Field Service Management
- Job Scheduling
- Technician Dispatch
- Customer WhatsApp Updates
- Invoicing and Payments
- Quote Management

## Photos to Upload

- [ ] Logo (min 720x720px)
- [ ] Cover photo (branded or product screenshot)
- [ ] 3–5 product screenshots
- [ ] Team photo (if available)

## Q&A Section (pre-answer these)

**Q: What industries does ServiceMen work for?**
A: Plumbing, electrical, appliance repair, aircon servicing, pest control, cleaning, and general maintenance — any business that sends technicians to customers.

**Q: What size business is ServiceMen built for?**
A: We're built for owner-led or manager-led service businesses with 3 to 15 technicians. That's the stage where informal systems start breaking.

**Q: Is ServiceMen WhatsApp-based?**
A: Yes. Your customers interact via WhatsApp. Your team gets job updates via WhatsApp. You manage everything from a simple dashboard.

**Q: Is there a free trial?**
A: Yes — our Founding 50 cohort includes 3 months free. WhatsApp us to check availability.

## Weekly Update Post Template

> [Business name] is now using ServiceMen to manage their [X]-technician [trade] business in [area]. From job request to payment — all handled without a spreadsheet. WhatsApp us to see how: [wa.me link]
```

- [ ] **Step 9: Create `docs/marketing/lead-magnets/whatsapp-template-pack.md`**

```markdown
# Lead Magnet 1: WhatsApp Template Pack for Service Businesses

> Delivery: WhatsApp DM (send manually or via bot when triggered)
> Trigger phrase: TEMPLATES
> File format: This document (copy-paste or send as PDF)
> Page: /free-templates on marketing site

---

## Delivery Message (send this first)

> Hi [Name] 👋 Here's your free ServiceMen WhatsApp Template Pack — 5 messages your team should be sending for every service job.
>
> Copy, paste, and customise the [brackets] for your business. Save them as WhatsApp Quick Replies to send in one tap.
>
> ---

## Template 1: New Job Request Acknowledgement

> Hi [Customer Name], thanks for reaching out to [Business Name]. We've received your request for [service type] and will send you a quote within [X hours/by end of day].
>
> In the meantime, if you have any more details to share (photos, address, preferred time), feel free to send them here.
>
> [Your name] — [Business Name]

**When to send:** Within 5 minutes of receiving any new job request.
**Why it matters:** Customers who get fast acknowledgements are far less likely to contact a competitor.

---

## Template 2: Quote Ready

> Hi [Customer Name], your quote for [job description] is ready.
>
> 💰 Total: R[amount] (includes [brief breakdown if needed])
> 📅 Available: [date options or "anytime this week"]
>
> Reply YES to confirm your booking, or let me know if you have any questions.
>
> [Your name] — [Business Name]

**When to send:** As soon as the quote is prepared — same day if possible.
**Why it matters:** Quotes sent the same day close at 3x the rate of quotes sent 48+ hours later.

---

## Template 3: Booking Confirmation

> Hi [Customer Name], your booking is confirmed ✅
>
> 📅 Date: [date]
> 🕐 Arrival window: [time range, e.g. 9am–11am]
> 👤 Technician: [name]
> 📍 Address we have: [address] — let me know if this needs updating.
>
> We'll send you a message when [Technician name] is on the way.
>
> [Your name] — [Business Name]

**When to send:** Immediately after booking is confirmed.
**Why it matters:** Eliminates the "are you still coming?" calls and sets clear expectations.

---

## Template 4: Technician On The Way

> Hi [Customer Name], [Technician Name] is on the way to you now and should arrive in approximately [X] minutes.
>
> 📍 You can contact [him/her] directly on [number] if needed.
>
> [Your name] — [Business Name]

**When to send:** When the technician leaves for the job.
**Why it matters:** This single message eliminates 80% of "where is my technician" calls.

---

## Template 5: Job Complete — Payment Request

> Hi [Customer Name], the job is complete ✅
>
> Here's your invoice:
> 📋 Job: [description]
> 💰 Amount due: R[amount]
> 🏦 [Payment method: EFT / SnapScan / Zapper / cash]
> 🔢 Reference: [your reference number]
>
> Please send proof of payment to this number, or pay via [link if applicable].
>
> Thank you for using [Business Name] — we appreciate your support! 🙏

**When to send:** Within 15 minutes of job completion, while the technician is still on site.
**Why it matters:** Payment collection rate drops sharply once the technician leaves without an invoice.

---

## Follow-Up Delivery Message

> That's your 5 templates 👆 Save them as Quick Replies in WhatsApp Business so you can send them in one tap next time.
>
> These are the manual version. Want to see what it looks like when ServiceMen sends all of these automatically — without you typing a thing?
>
> Reply DEMO and I'll set up a quick 30-minute walkthrough for your business specifically.
```

- [ ] **Step 10: Create `docs/marketing/lead-magnets/dispatch-checklist.md`**

```markdown
# Lead Magnet 2: Daily Dispatch Checklist for Service Team Managers

> Delivery: WhatsApp DM — send as image or PDF
> Trigger phrase: CHECKLIST
> Design: Simple one-page printable — A4 or phone-screen friendly

---

## Delivery Message

> Hi [Name] 👋 Here's your free ServiceMen Dispatch Checklist — run through this every morning before your team hits the road.
>
> Print it out, screenshot it, or save it. Takes 5–10 minutes and prevents most of the chaos that happens mid-morning.

---

## THE DAILY DISPATCH CHECKLIST
### ServiceMen App — Free Resource

**Run this every morning before 8am**

---

### ✅ Jobs Confirmed

- [ ] All jobs for today have been confirmed with the customer (no "are you still coming" calls)
- [ ] All customers have the technician's name and an arrival window
- [ ] Any cancellations or reschedules from yesterday have been reassigned

---

### ✅ Technicians Briefed

- [ ] Each technician knows their first job address and arrival time
- [ ] Each technician has the customer's WhatsApp number saved
- [ ] No technician has more than [X] jobs scheduled without buffer time

---

### ✅ Equipment and Parts

- [ ] Any parts ordered yesterday have been confirmed for delivery or pickup
- [ ] Each technician has the tools needed for today's specific jobs
- [ ] Stock of common consumables (tape, fittings, etc.) checked

---

### ✅ Open Quotes

- [ ] Any quotes sent more than 2 days ago without a reply have been followed up
- [ ] Any quotes accepted yesterday have been converted into bookings

---

### ✅ Outstanding Payments

- [ ] Any invoices older than 7 days have had a payment reminder sent
- [ ] Any jobs completed yesterday without payment recorded have been flagged

---

### ✅ Yesterday's Exceptions

- [ ] Any customer complaints from yesterday have been acknowledged and assigned
- [ ] Any jobs that couldn't be completed have been rescheduled

---

**Time to complete this checklist:** 5–10 minutes
**If it's taking longer:** Your system is doing too little. ServiceMen automates most of this.

---

## Follow-Up Delivery Message

> That's your checklist 👆
>
> If going through this takes you more than 15 minutes every morning, it's a sign that too much is living in your head and your group chats.
>
> ServiceMen handles the follow-ups, reminders, and customer updates automatically.
>
> Want to see how? Reply DEMO and I'll show you exactly how it fits your team's workflow.
```

- [ ] **Step 11: Create `docs/marketing/lead-magnets/cashflow-tracker.md`**

```markdown
# Lead Magnet 3: SA Service Business Cash Flow Tracker (Google Sheets)

> Delivery: Google Sheets link via WhatsApp DM
> Trigger phrase: TRACKER
> Build: Create the Google Sheet once, share as "anyone with link can view" (they copy it to their Drive)

---

## Delivery Message

> Hi [Name] 👋 Here's your free ServiceMen Cash Flow Tracker — a Google Sheets template built for SA service businesses.
>
> 👉 Click to copy: [Google Sheets link]
>
> Open the link → File → Make a Copy → save to your Drive.

---

## Sheet Structure to Build

### Tab 1: Jobs Log

| Column | Field | Notes |
|---|---|---|
| A | Date | Job date |
| B | Customer Name | |
| C | Contact Number | |
| D | Job Type | Dropdown: plumbing / electrical / appliance / other |
| E | Technician | Name |
| F | Quoted Amount (R) | |
| G | Invoiced Amount (R) | |
| H | Payment Status | Dropdown: Unpaid / Partial / Paid |
| I | Payment Date | |
| J | Days Outstanding | Formula: =IF(H2="Paid","",TODAY()-A2) |
| K | Notes | |

### Tab 2: Dashboard (auto-calculated)

| Metric | Formula |
|---|---|
| Revenue this month | =SUMIFS(Jobs!G:G, Jobs!A:A, ">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1), Jobs!H:H, "Paid") |
| Revenue outstanding | =SUMIFS(Jobs!G:G, Jobs!H:H, "Unpaid") |
| Invoices unpaid > 14 days | =COUNTIFS(Jobs!J:J, ">"&14, Jobs!H:H, "Unpaid") |
| Average days to payment | =AVERAGEIF(Jobs!H:H, "Paid", Jobs!J:J) |
| Jobs this month | =COUNTIFS(Jobs!A:A, ">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1)) |
| Technician with most jobs | =INDEX(Jobs!E:E,MATCH(MAX(COUNTIF(Jobs!E2:E1000,Jobs!E2:E1000)),COUNTIF(Jobs!E2:E1000,Jobs!E2:E1000),0)+1) |

### Tab 3: Outstanding Invoices (filtered view)

Auto-filter: shows only rows where Payment Status = "Unpaid", sorted by Days Outstanding descending.

---

## Follow-Up Delivery Message

> That's your tracker 👆
>
> The dashboard tab will show you your outstanding invoices and average payment time automatically as you add jobs.
>
> Most service businesses who fill this in for a week are shocked at how much is sitting unpaid.
>
> ServiceMen can automate the follow-up on those unpaid invoices — no manual chasing needed.
>
> Want to see how? Reply DEMO.
```

- [ ] **Step 12: Create `docs/marketing/kpi-dashboard.md`**

```markdown
# KPI Dashboard — ServiceMen App Go-To-Market

> Track these every Monday (weekly) and at month-end (monthly).
> Spreadsheet tool: Google Sheets recommended.

---

## Weekly Snapshot Tab

Columns:
```
Week | Start Date | Platform | Impressions | Engagements | Eng Rate % | New Followers | WhatsApp Convos | Demos Booked
```

Formulas:
- Engagement Rate: `=Engagements/Impressions*100`

| Metric | Week 1–4 Target | Week 5–8 Target | Week 9–12 Target |
|---|---|---|---|
| Facebook reach | 500 | 2,000 | 5,000 |
| Instagram reach | — | 1,000 | 3,000 |
| Facebook page followers | 20/week | 50/week | 100/week |
| Instagram followers | — | 30/week | 60/week |
| WhatsApp conversations started | 5 | 15 | 30 |
| Demo calls booked | 2 | 5 | 10 |
| Lead magnet downloads (from /free-templates) | 5 | 20 | 40 |

---

## Monthly Funnel Tab

Columns:
```
Month | Reach | Link Clicks | WhatsApp Convos | Lead Magnet Downloads | Demos | Opportunities | Customers | MRR (R)
```

Formulas:
- Click rate: `=Clicks/Reach*100`
- Conversation rate: `=Convos/Clicks*100`
- Demo rate: `=Demos/Convos*100`
- Close rate: `=Customers/Demos*100`

| Metric | Month 1 | Month 2 | Month 3 |
|---|---|---|---|
| WhatsApp conversations | 30 | 80 | 150 |
| Lead magnet downloads | 20 | 60 | 120 |
| Demo calls completed | 10 | 25 | 40 |
| Lead-to-demo rate | 33% | 30% | 27% |
| Demo-to-close rate | 20% | 25% | 30% |
| New paying customers | 2 | 8 | 12 |
| MRR added (R) | R3,000 | R12,000 | R20,000 |

---

## Paid Media Tab (Month 2+)

Columns:
```
Campaign | Budget (R) | Impressions | Clicks | WhatsApp Convos | Lead Magnets | Demos | Customers | CPL (R) | CPD (R) | CAC (R)
```

Formulas:
- CPL (cost per lead / WhatsApp conversation): `=Spend/Convos`
- CPD (cost per demo): `=Spend/Demos`
- CAC (cost per acquisition): `=Total_spend/Customers`

Kill rule: any ad with CPL > R300 after R500 spend → pause and test new creative.

---

## GA4 Events to Track

These are fired from the marketing site automatically:

| Event | Fired when | Key params |
|---|---|---|
| `cta_click` | Any CTA button clicked | label, location, audience |
| `whatsapp_click` | WhatsApp link opened | source |
| `lead_magnet_download` | LeadMagnetForm submitted | magnet, source |
| `section_view` | Page section enters viewport | section_name |
| `scroll_depth` | User reaches 25/50/75/100% of page | depth |

Check GA4 Realtime and Events reports weekly.
```

- [ ] **Step 13: Create `docs/marketing/content-calendar-12-week.md`**

```markdown
# 12-Week Content Calendar — ServiceMen App

> LinkedIn: PAUSED. Not included in this calendar.
> Active platforms: Facebook Page, Facebook Groups, Instagram, WhatsApp Status, Google Business Profile
> Start date: [Insert actual start date]

---

| Week | Platform | Audience | Funnel Stage | Content Pillar | Format | Hook | Content Angle | CTA | Asset Needed |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Facebook Page | Service biz owners | Awareness | The Problem | Text + image | "How many WhatsApp messages do you send before a job is booked?" | Pain validation — manual booking chaos | Comment / WhatsApp link | Brand image |
| 1 | Facebook Groups | Plumbers, electricians | Awareness | Founder story | Text only | "Quick question for service business owners in Gauteng…" | Survey-style engagement | Comments | None |
| 1 | WhatsApp Status | Warm contacts | Awareness | The Problem | Short text/image | "Running jobs on WhatsApp? There's a better version of that." | Product teaser | WhatsApp DM | Simple graphic |
| 1 | Google Business | Local searchers | Awareness | Product | Post update | "ServiceMen App now live in Gauteng" | What the platform does | Website link | Screenshot |
| 2 | Facebook Page | All trades | Awareness | The Fix | Short video (60s) | "What does a job request look like in ServiceMen?" | Product walkthrough | Comment DEMO | Screen recording |
| 2 | Facebook Groups | Trade contractors | Trust | The Fix | Text post | "For anyone managing technician schedules manually…" | Soft product intro | WhatsApp link | None |
| 2 | WhatsApp Status | Warm contacts | Trust | Product | Image | "Job confirmed. Technician dispatched. Customer notified. All from one screen." | Feature highlight | Reply to chat | Product screenshot |
| 2 | Google Business | Local searchers | Trust | Product | Post update | "How ServiceMen handles a job from start to finish" | End-to-end flow | Website link | Flow diagram |
| 3 | Facebook Page | Appliance repair, pest control | Awareness | The Problem | Image + caption | "Your phone is your CRM. Your WhatsApp is your dispatch system." | Relatable pain | WhatsApp link | Quote graphic |
| 3 | Instagram | SME owners | Awareness | The Problem | Static graphic | "Your phone is your CRM. Your WhatsApp is your dispatch system." | Pain validation | Link in bio | Quote graphic |
| 3 | Instagram | SME owners | Awareness | The Fix | Reel (30s) | "Stop answering 'are you coming?' calls" | Short product demo | Link in bio | Screen recording |
| 3 | Facebook Groups | SA SME groups | Awareness | How-To | Text | "What's your process for following up on quotes?" | Value-add engagement | Comments | None |
| 4 | Facebook Page | Electrical contractors | Trust | Social Proof | Image + caption | "What our first users said after week one" | Early testimonials | WhatsApp link | Quote graphic |
| 4 | Instagram | SME audience | Trust | Social Proof | Static | "[Early user quote]" | Testimonial pull quote | Link in bio | Quote graphic |
| 4 | Facebook Groups | Plumbing groups | Trust | Social Proof | Text | "Sharing an early result from one of our first users" | Soft social proof | WhatsApp link | None |
| 4 | WhatsApp Status | Warm contacts | Trust | Social Proof | Text | "3 payments collected in one day — zero calls made" | Result highlight | Reply to chat | None |
| 5 | Facebook Page | All trades | Lead Gen | Lead Magnet | Image + caption | "Free: 5 WhatsApp templates for SA service businesses" | Lead magnet launch | WhatsApp TEMPLATES | Template preview graphic |
| 5 | Instagram | SME audience | Lead Gen | Lead Magnet | Static + story | "Free WhatsApp template pack for service businesses" | Lead magnet visual | Link in bio | Graphic |
| 5 | Facebook Groups | All target groups | Lead Gen | Lead Magnet | Text | "Put together something free for SA service businesses…" | Lead magnet soft launch | /free-templates link | None |
| 5 | Google Business | Local searchers | Lead Gen | Lead Magnet | Post update | "Free WhatsApp template pack — now available" | Lead magnet announcement | /free-templates link | None |
| 6 | Facebook Page | Maintenance biz | Trust | How-To | Text + image | "How to follow up on an unpaid quote without being annoying" | Practical tips | Save / share | Graphic |
| 6 | Instagram | SME audience | Trust | How-To | Carousel | "3 things to fix in your service business before you take on more customers" | Ops tips carousel | Save this | Carousel slides |
| 6 | Facebook Groups | Trade groups | Trust | How-To | Text | "End-of-day checklist for service team managers" | Practical value | Comments | None |
| 6 | WhatsApp Status | Warm contacts | Trust | How-To | Text | "The 5-minute end-of-day checklist every service biz owner needs" | Practical tip | Reply to chat | None |
| 7 | Facebook Page | All service biz | Trust | Case Study | Image + caption | "Before ServiceMen: 12 missed callbacks in a week. After: zero." | Before/after result | Comment STORY | Before/after graphic |
| 7 | Instagram | SME audience | Trust | Case Study | Reel (45s) | "A day in the life of a ServiceMen user" | Day-in-the-life | Link in bio | Video/screen recording |
| 7 | Facebook Groups | Electrical groups | Trust | Case Study | Text | "Sharing a result from one of our Gauteng users" | Detailed case story | WhatsApp link | None |
| 7 | Google Business | Local searchers | Trust | Social Proof | Post update | "Electrical contractor in Randburg — now running [X] technicians on ServiceMen" | Customer result | Website link | None |
| 8 | Facebook Page | Cleaning, pest control | Lead Gen | Feature | Video | "How the booking flow works from request to dispatch" | Full flow demo | Comment DEMO | Screen recording |
| 8 | Instagram | SME owners | Lead Gen | Lead Magnet | Story series | "Swipe: the dispatch checklist every service business needs" | Checklist lead magnet | DM CHECKLIST | Story slides |
| 8 | Facebook Groups | SA SME groups | Objection | Objection Handling | Text | "'We already use WhatsApp' — here's what that actually means" | Objection address | WhatsApp link | None |
| 8 | WhatsApp Status | Warm contacts | Lead Gen | Lead Magnet | Image | "Free dispatch checklist — send CHECKLIST to get yours" | Lead magnet #2 push | Reply CHECKLIST | Checklist graphic |
| 9 | Facebook Page | All trades | Trust | Industry Insight | Image + caption | "Load shedding and your service business — how to protect your schedule" | SA-specific insight | WhatsApp link | Graphic |
| 9 | Instagram | SME audience | Trust | Social Proof | Static | "[Milestone: X businesses now on ServiceMen]" | Traction milestone | Link in bio | Milestone graphic |
| 9 | Facebook Groups | All target groups | Trust | Industry Insight | Text | "What load shedding does to service business scheduling (and what to do about it)" | Insight post | Comments | None |
| 9 | Google Business | Local searchers | Trust | Milestone | Post update | "[X] service businesses now managing jobs on ServiceMen in Gauteng" | Traction proof | Website link | None |
| 10 | Facebook Page | All trades | Trust | How-To | Image + caption | "The 5-minute end-of-day checklist for service business owners" | Practical ops tip | Save this | Checklist graphic |
| 10 | Instagram | SME audience | Trust | Social Proof | Reel | "A day in the life of a ServiceMen user" | Customer POV | Link in bio | Video |
| 10 | Facebook Groups | SA SME groups | Trust | Founder | Text | "What I got wrong about building software for service businesses" | Founder vulnerability | Comments | None |
| 10 | WhatsApp Status | Warm contacts | Trust | Milestone | Text | "[X] businesses. [X] jobs dispatched. Growing every week." | Traction milestone | Reply to chat | None |
| 11 | Facebook Page | All verticals | Conversion | Offer | Image + caption | "Founding 50 — 12 spots left" | Urgency close | Comment FOUNDING | Deadline graphic |
| 11 | Instagram | SME audience | Conversion | Offer | Static + story | "Founding 50 — join before [date]" | Urgency visual | Link in bio | Deadline graphic |
| 11 | Facebook Groups | All target groups | Conversion | Offer | Text | "Last spots in the ServiceMen Founding 50 — closing [date]" | Conversion push | WhatsApp link | None |
| 11 | Google Business | Local searchers | Conversion | Offer | Post update | "Founding 50 early access — last spots available" | Urgency | Website link | None |
| 12 | Facebook Page | All | Trust + Referral | Social Proof | Image + caption | "90 days. [X] businesses. [X] jobs managed." | Results milestone | Refer a business | Stats graphic |
| 12 | Instagram | SME audience | Trust | Founder Story | Reel | "Why we built this, 90 days later" | Reflection + momentum | Link in bio | Founder video |
| 12 | Facebook Groups | All | Trust | Social Proof | Text | "90-day update from the ServiceMen team" | Community milestone | WhatsApp link | None |
| 12 | Google Business | Local searchers | Trust | Milestone | Post update | "90 days in — [X] service businesses in Gauteng now on ServiceMen" | Results proof | Website link | None |
```

- [ ] **Step 14: Run full test suite and confirm all tests pass**

```bash
cd marketing && npx vitest run
```

Expected: All tests pass — including 9 new lead-magnet tests.

- [ ] **Step 15: Commit all docs**

```bash
git add docs/marketing/
git commit -m "docs(marketing): add full content asset library for 90-day GTM plan"
```

- [ ] **Step 16: Final commit — push branch**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Lead magnet landing page | Task 6 |
| Lead magnet form component | Task 5 |
| API extension for lead_magnet type | Task 2 |
| Supabase migration | Task 1 |
| Analytics event | Task 3 |
| Tests (separate file, no mock collision) | Task 4 |
| Facebook post drafts (12) | Task 7 Step 1 |
| Instagram captions (12) | Task 7 Step 2 |
| Ad copy — static (6) + click-to-WhatsApp (6) | Task 7 Step 3 |
| Video scripts (6) | Task 7 Step 4 |
| WhatsApp Business setup | Task 7 Step 5 |
| Facebook Page setup | Task 7 Step 6 |
| Instagram setup | Task 7 Step 7 |
| Google Business Profile setup | Task 7 Step 8 |
| WhatsApp Template Pack content | Task 7 Step 9 |
| Dispatch Checklist content | Task 7 Step 10 |
| Cash Flow Tracker structure | Task 7 Step 11 |
| KPI dashboard | Task 7 Step 12 |
| 12-week content calendar | Task 7 Step 13 |
| LinkedIn excluded | ✅ Not present anywhere |

**Placeholder scan:** All code blocks are complete. No TBDs. No "implement later".

**Type consistency:**
- `Magnet` type: `"template-pack" | "dispatch-checklist" | "cashflow-tracker"` — consistent across `leadMagnetSchema` (route.ts), `LeadMagnetForm` props, `analytics.leadMagnetDownload`, and tests.
- `magnetPrefill` keys match the `magnet` enum values exactly.
- `analytics.leadMagnetDownload` signature matches call site in `LeadMagnetForm`.
