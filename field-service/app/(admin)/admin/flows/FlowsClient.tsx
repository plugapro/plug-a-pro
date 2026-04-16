'use client'

import { MermaidDiagram } from '@/components/admin/MermaidDiagram'

type FlowDef = {
  id: string
  label: string
  description: string
  chart: string
  entryPoints: string[]
  outcomes: string[]
}

const PLATFORM_OVERVIEW = `
flowchart TB
  subgraph Customer Surfaces
    CS1["PWA routes: sign-in to services to book"]
    CS2["WhatsApp: job request, status, help"]
    CS3["Public links: request access, quote approval, extra work approval"]
  end

  subgraph Provider Surfaces
    PS1["WhatsApp registration and provider journey"]
    PS2["Provider PWA: dashboard, leads, quotes, jobs"]
  end

  subgraph Admin Surfaces
    AS1["Admin dashboard"]
    AS2["Queues: validation, dispatch, quotes, field exceptions, disputes"]
    AS3["Internal tools: applications, bookings, providers, payments, locations, reports"]
  end

  subgraph Platform Core
    API["Next.js routes and Server Actions"]
    BOT["WhatsApp state machine"]
    MATCH["Matching and dispatch engine"]
    TOKEN["Tokenized access layer"]
    OPS["Ops dashboard and queue services"]
  end

  subgraph Runtime Services
    DB["Supabase Postgres via Prisma"]
    BLOB["Vercel Blob"]
    CRON["Vercel cron jobs"]
    WEBHOOKS["WhatsApp and payment webhooks"]
  end

  CS1 --> API
  CS2 --> WEBHOOKS --> BOT --> API
  CS3 --> TOKEN --> API
  PS1 --> WEBHOOKS
  PS2 --> API
  AS1 --> OPS --> API
  AS2 --> OPS
  AS3 --> API

  API --> DB
  API --> BLOB
  MATCH --> DB
  OPS --> DB
  CRON --> API
  WEBHOOKS --> API

  style DB fill:#1e293b,color:#94a3b8
  style BLOB fill:#1e293b,color:#94a3b8
  style CS3 fill:#1d4ed8,color:#fff
  style AS1 fill:#123524,color:#fff
`

const CUSTOMER_PWA_JOURNEY = `
flowchart TD
  A["Customer on mobile"] --> B["Sign in"]
  B --> C["Verify phone OTP"]
  C --> D["Services"]
  D --> E["Book service"]

  E --> F[Choose province -> region/suburb]
  F --> G[Enter street address after suburb]
  G --> H[Add title + job details]
  H --> I[Submit request]

  I --> J["JobRequest created"]
  J --> K["Signed ticket URL returned"]
  K --> L["Scoped ticket page"]

  J --> M[Matching engine dispatches providers]
  M --> N{Provider accepts?}
  N -->|No| O[Request stays matching / escalates]
  N -->|Yes| P["Match created"]

  P --> Q{Inspection required?}
  Q -->|Yes| R[Inspection completed]
  Q -->|No| S[Provider submits quote]
  R --> S

  S --> T["Scoped quote approval page"]
  T --> U{Approve?}
  U -->|Decline| V[Provider revises quote]
  V --> S
  U -->|Approve| W["Booking and job created"]

  W --> X["Booking detail"]
  X --> Y[Track status + photos + extras]
  Y --> Z["Rate booking"]

  style A fill:#1d4ed8,color:#fff
  style L fill:#1e293b,color:#94a3b8
  style T fill:#1e293b,color:#94a3b8
  style W fill:#1e293b,color:#94a3b8
  style Z fill:#16a34a,color:#fff
`

const CUSTOMER_WHATSAPP_JOURNEY = `
flowchart TD
  A["Customer on WhatsApp"] --> B["Send greeting or service intent"]
  B --> C[Welcome menu]
  C --> D{Choice}

  D -->|Request a job| E[Category -> name -> suburb/location]
  E --> F[Street address after location]
  F --> G[Availability / confirmation]
  G --> H[(JobRequest created)]
  H --> I["Direct ticket link sent"]
  I --> J["Scoped ticket page"]

  D -->|Track booking| K[Status flow]
  D -->|Help| L[FAQ / support flow]

  H --> M[Matching engine]
  M --> N[Provider lead broadcast]
  N --> O[Customer later receives quote link or booking updates]

  O --> P{Needs action?}
  P -->|Quote decision| Q["Scoped quote approval page"]
  P -->|Extra work| R["Scoped extra work approval page"]
  P -->|Ticket view only| J

  style A fill:#25d366,color:#000
  style H fill:#1e293b,color:#94a3b8
  style J fill:#1d4ed8,color:#fff
  style Q fill:#1d4ed8,color:#fff
  style R fill:#1d4ed8,color:#fff
`

const PROVIDER_JOURNEY = `
flowchart TD
  A["Worker or provider"] --> B{Entry path}
  B -->|WhatsApp| C[Registration flow]
  B -->|Approved account| D["Provider sign in and verify"]

  C --> E[Name]
  E --> F[Multi-select skills]
  F --> G[Coverage area by province / city / region]
  G --> H[Experience + availability + evidence note]
  H --> I["ProviderApplication pending"]
  I --> J["Admin applications review"]
  J -->|Approved| D
  J -->|Rejected| K[Application stays closed / pending follow-up]

  D --> L["Provider dashboard"]
  L --> M[See active and upcoming jobs]
  L --> N["Provider leads"]
  N --> O["Lead detail"]
  O --> P{Accept lead?}
  P -->|Decline| N
  P -->|Accept| Q["Provider quote builder"]

  Q --> R{Inspection flow or direct quote}
  R --> S[Submit quote]
  S --> T["Customer approves via token link"]
  T --> U["Booking and job exist"]

  U --> V["Provider job detail"]
  V --> W[Status updates]
  W --> X[Upload work photos]
  X --> Y[Optional extra work request]
  Y --> Z[Customer confirms completion]

  L --> AA["Provider profile"]
  AA --> AB[Skills + service areas + schedule]
  L --> AC["Provider earnings"]

  style A fill:#7c3aed,color:#fff
  style I fill:#1e293b,color:#94a3b8
  style U fill:#1e293b,color:#94a3b8
  style Z fill:#16a34a,color:#fff
`

const ADMIN_OPS_JOURNEY = `
flowchart TD
  A["Owner or Admin"] --> B["Admin sign in"]
  B --> C["Admin home"]
  C --> D[Operations dashboard]

  D --> E[Validation queue]
  D --> F[Dispatch queue]
  D --> G[Quote approvals]
  D --> H[Field exceptions]
  D --> I[Incidents bar / SLA signals]

  E --> J[Claim / release / mark ready]
  F --> K[Review candidates / rerank / override]
  G --> L[Claim / release / audit trail]
  H --> M[Review job issues / audit trail]

  C --> N["Applications"]
  N --> O[Approve / reject provider applications]

  C --> P["Bookings"]
  P --> Q[Inspect booking, payment, job, attachments]

  C --> R["Disputes"]
  R --> S[Resolve or close disputes]

  C --> T["Payments"]
  T --> U[Refunds / payment follow-up]

  C --> V["Locations"]
  V --> W[Maintain taxonomy]

  C --> X["Reports"]
  X --> Y[Operational summaries]

  style A fill:#123524,color:#fff
  style D fill:#1e293b,color:#94a3b8
  style I fill:#dc2626,color:#fff
`

const TOKENIZED_ACCESS = `
flowchart LR
  A[Scoped public link created] --> B{Link type}
  B -->|Ticket| C["Scoped ticket page"]
  B -->|Quote approval| D["Scoped quote approval page"]
  B -->|Extra work approval| E["Scoped extra work approval page"]

  C --> F[Resolve token -> one job request only]
  F --> G[Render request, provider, quote, booking, photos]
  G --> H["Attachment proxy with token"]

  D --> I["Resolve approval token to one quote"]
  I --> J[Approve or decline]
  J --> K["Booking and job creation on approval"]

  E --> L[Resolve extra-work token]
  L --> M[Approve or decline extra work]

  H --> N{Session or token scope}
  N -->|Valid| O[Serve attachment]
  N -->|Invalid / expired| P[Reject safely]

  style C fill:#1d4ed8,color:#fff
  style D fill:#1d4ed8,color:#fff
  style E fill:#1d4ed8,color:#fff
  style P fill:#dc2626,color:#fff
`

const AUTOMATIONS_AND_SIGNALS = `
flowchart TD
  A["JobRequest, Match, Booking changes"] --> B[Matching engine]
  B --> C[Lead dispatch]
  C --> D[WhatsApp / push notifications]

  E["Vercel cron"] --> F["Match leads cron"]
  E --> G["Reminders cron"]
  E --> H["Follow-up cron"]
  E --> I["Session timeout cron"]
  E --> J["Ops alerts cron"]

  F --> K[Retry dispatch / reconcile applications]
  G --> L[Booking reminder messages]
  H --> M[Follow-up messages]
  I --> N[Reset stale WhatsApp sessions]
  J --> O[Queue breach detection]
  O --> P[Ops WhatsApp alert]

  Q["Inbound webhooks"] --> R["WhatsApp webhook"]
  Q --> S["Payments webhook"]
  R --> T[Conversation routing + dedupe]
  S --> U[Payment state sync]

  style E fill:#123524,color:#fff
  style P fill:#dc2626,color:#fff
  style R fill:#25d366,color:#000
  style S fill:#f59e0b,color:#000
`

const REQUEST_LIFECYCLE = `
flowchart TD
  A["JobRequest OPEN"] --> B["JobRequest MATCHING"]
  B --> C{Lead accepted?}
  C -->|No| D["JobRequest EXPIRED or OPS review"]
  C -->|Yes| E["Match MATCHED"]

  E --> F{Inspection needed?}
  F -->|Yes| G["INSPECTION_SCHEDULED"]
  G --> H["INSPECTION_COMPLETE"]
  H --> I["Match QUOTED"]
  F -->|No| I

  I --> J{Customer decision}
  J -->|Decline| K["QUOTE_DECLINED"]
  K --> I
  J -->|Approve| L["Booking SCHEDULED"]

  L --> M["Job SCHEDULED"]
  M --> N["EN_ROUTE"]
  N --> O["ARRIVED"]
  O --> P["STARTED"]
  P --> Q["PAUSED or AWAITING_APPROVAL"]
  Q --> P
  P --> R["PENDING_COMPLETION_CONFIRMATION"]
  R --> S["COMPLETED"]

  P --> T["Dispute OPEN"]
  R --> T
  T --> U["Dispute resolved or booking outcome managed"]

  style A fill:#1e293b,color:#94a3b8
  style E fill:#1e293b,color:#94a3b8
  style L fill:#1e293b,color:#94a3b8
  style M fill:#1e293b,color:#94a3b8
  style S fill:#16a34a,color:#fff
  style T fill:#dc2626,color:#fff
`

const FLOWS: FlowDef[] = [
  {
    id: 'overview',
    label: 'Platform Overview',
    description: 'Current channels, internal surfaces, and platform services.',
    chart: PLATFORM_OVERVIEW,
    entryPoints: [
      'Customer PWA routes under /(customer)',
      'WhatsApp inbound webhook and bot state machine',
      'Provider PWA routes under /provider and /technician',
      'Admin operations routes under /admin',
    ],
    outcomes: [
      'Shows how public links, WhatsApp, admin tools, and cron all meet at the same application core.',
      'Reflects the current queue-first operations model rather than the older generic marketplace story.',
    ],
  },
  {
    id: 'customer-pwa',
    label: 'Customer PWA Journey',
    description: 'Phone-authenticated customer path from service selection to rating.',
    chart: CUSTOMER_PWA_JOURNEY,
    entryPoints: [
      '/sign-in and /verify',
      '/services and /book/:serviceId',
      '/requests/:id and /bookings/:id',
    ],
    outcomes: [
      'Captures the progressive address flow and signed ticket handoff after request creation.',
      'Shows the current quote approval and booking transition path.',
    ],
  },
  {
    id: 'customer-whatsapp',
    label: 'Customer WhatsApp Journey',
    description: 'Request, status, and help flows handled directly in WhatsApp.',
    chart: CUSTOMER_WHATSAPP_JOURNEY,
    entryPoints: [
      'Inbound WhatsApp messages',
      'Job request flow',
      'Status and help flows',
    ],
    outcomes: [
      'Shows the no-login request path and the tokenized ticket, quote, and extra-work links.',
      'Matches the current conversation router instead of the earlier simplified bot diagram.',
    ],
  },
  {
    id: 'provider',
    label: 'Provider Journey',
    description: 'From application through lead response, job execution, and profile maintenance.',
    chart: PROVIDER_JOURNEY,
    entryPoints: [
      'WhatsApp provider registration flow',
      '/provider-sign-in and /provider-verify',
      '/provider, /provider/leads, /provider/quotes/:matchId, /provider/jobs/:id',
    ],
    outcomes: [
      'Reflects current single-step skill selection and structured service-area capture.',
      'Shows evidence-of-work and extra-work handling on the live provider job path.',
    ],
  },
  {
    id: 'admin',
    label: 'Admin Operations Journey',
    description: 'What the operations team actually does inside the platform today.',
    chart: ADMIN_OPS_JOURNEY,
    entryPoints: [
      'admin.plugapro.co.za/sign-in',
      '/admin dashboard',
      'queue pages and internal admin modules',
    ],
    outcomes: [
      'Focuses on operational queues, applications, disputes, payments, locations, and reports.',
      'Matches the current control-tower model instead of a generic back-office view.',
    ],
  },
  {
    id: 'tokens',
    label: 'Public Token Access',
    description: 'Secure single-entity customer access without a full login hop.',
    chart: TOKENIZED_ACCESS,
    entryPoints: [
      '/requests/access/:token',
      '/quotes/:token',
      '/approve/:token',
      '/api/attachments/:id?token=...',
    ],
    outcomes: [
      'Shows the current secure deep-link architecture and the scoped attachment proxy.',
      'Makes the token model explicit for support and ops teams.',
    ],
  },
  {
    id: 'lifecycle',
    label: 'Request Lifecycle',
    description: 'How JobRequest, Match, Booking, Job, and Dispute states connect.',
    chart: REQUEST_LIFECYCLE,
    entryPoints: [
      'Job request creation',
      'Matching and quote handling',
      'Booking and field execution',
    ],
    outcomes: [
      'Reflects the current multi-model lifecycle rather than only a single state machine.',
      'Useful for ops/debugging when a request appears stuck between stages.',
    ],
  },
  {
    id: 'automation',
    label: 'Automations and Signals',
    description: 'Cron, webhooks, notifications, and operational alerts.',
    chart: AUTOMATIONS_AND_SIGNALS,
    entryPoints: [
      'Vercel cron routes',
      'WhatsApp and payment webhooks',
      'Ops alerting and reminders',
    ],
    outcomes: [
      'Shows the current scheduled and event-driven behavior that supports the marketplace.',
      'Makes background operational dependencies visible to admins.',
    ],
  },
]

export function FlowsClient() {
  return (
    <div className="space-y-6">
      <div className="border border-zinc-400 bg-[#fbfbf9] px-6 py-6">
        <div className="mb-5 h-px w-full bg-zinc-400" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-zinc-500">
              Platform Narrative
            </p>
            <h1 className="font-serif text-4xl tracking-tight text-zinc-950">Current User Journey Flows</h1>
            <p className="max-w-3xl text-sm leading-7 text-zinc-600">
              Regenerated from the implemented routes, token access paths, WhatsApp handlers, admin queues,
              and request lifecycle in the current codebase.
            </p>
          </div>

          <div className="border border-zinc-300 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
              Included Boards
            </p>
            <ol className="mt-3 space-y-2 font-serif text-sm text-zinc-700">
              {FLOWS.map((flow, index) => (
                <li key={flow.id} className="flex gap-3">
                  <span className="w-5 shrink-0 text-zinc-400">{String(index + 1).padStart(2, '0')}</span>
                  <span>{flow.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {FLOWS.map((flow, index) => (
          <section key={flow.id} className="border border-zinc-400 bg-[#fbfbf9]">
            <div className="grid gap-0 xl:grid-cols-[minmax(0,1.45fr)_360px]">
              <div className="border-b border-zinc-300 p-5 xl:border-b-0 xl:border-r">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
                      Board {String(index + 1).padStart(2, '0')}
                    </p>
                    <h2 className="font-serif text-3xl leading-tight text-zinc-950">{flow.label}</h2>
                  </div>
                  <div className="border border-zinc-300 bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                    Journey
                  </div>
                </div>
                <p className="mb-5 max-w-3xl text-sm leading-7 text-zinc-600">{flow.description}</p>
                <MermaidDiagram chart={flow.chart} />
              </div>

              <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-1">
                <div className="border-b border-zinc-300 p-5 md:border-r xl:border-r-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                    Entry Points
                  </p>
                  <ul className="mt-4 space-y-3 text-sm leading-7 text-zinc-700">
                    {flow.entryPoints.map((item) => (
                      <li key={item} className="border-b border-zinc-200 pb-3 last:border-b-0 last:pb-0">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                    Annotation
                  </p>
                  <ul className="mt-4 space-y-3 text-sm leading-7 text-zinc-700">
                    {flow.outcomes.map((item) => (
                      <li key={item} className="border-b border-zinc-200 pb-3 last:border-b-0 last:pb-0">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
