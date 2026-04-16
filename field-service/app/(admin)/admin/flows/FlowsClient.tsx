'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
    CS1[PWA<br/>/sign-in -> /services -> /book/:serviceId]
    CS2[WhatsApp<br/>job request / status / help]
    CS3[Public links<br/>/requests/access/:token<br/>/quotes/:token<br/>/approve/:token]
  end

  subgraph Provider Surfaces
    PS1[WhatsApp registration<br/>and provider journey]
    PS2[PWA<br/>/provider, /provider/leads,<br/>/provider/quotes/:matchId,<br/>/provider/jobs/:id]
  end

  subgraph Admin Surfaces
    AS1[/admin dashboard]
    AS2[Queues<br/>validation, dispatch, quotes,<br/>field exceptions, disputes]
    AS3[Internal tools<br/>applications, bookings, providers,<br/>payments, locations, reports]
  end

  subgraph Platform Core
    API[Next.js routes + Server Actions]
    BOT[WhatsApp state machine]
    MATCH[Matching + dispatch engine]
    TOKEN[Tokenized access layer]
    OPS[Ops dashboard + queue services]
  end

  subgraph Runtime Services
    DB[(Supabase Postgres via Prisma)]
    BLOB[(Vercel Blob)]
    CRON[Vercel cron jobs]
    WEBHOOKS[WhatsApp + payment webhooks]
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
  A([Customer on mobile]) --> B[/sign-in]
  B --> C[/verify phone OTP]
  C --> D[/services]
  D --> E[/book/:serviceId]

  E --> F[Choose province -> region/suburb]
  F --> G[Enter street address after suburb]
  G --> H[Add title + job details]
  H --> I[Submit request]

  I --> J[(JobRequest created)]
  J --> K[Signed ticket URL returned]
  K --> L[/requests/access/:token]

  J --> M[Matching engine dispatches providers]
  M --> N{Provider accepts?}
  N -->|No| O[Request stays matching / escalates]
  N -->|Yes| P[(Match created)]

  P --> Q{Inspection required?}
  Q -->|Yes| R[Inspection completed]
  Q -->|No| S[Provider submits quote]
  R --> S

  S --> T[/quotes/:token approval page]
  T --> U{Approve?}
  U -->|Decline| V[Provider revises quote]
  V --> S
  U -->|Approve| W[(Booking + Job created)]

  W --> X[/bookings/:id]
  X --> Y[Track status + photos + extras]
  Y --> Z[/bookings/:id/rate]

  style A fill:#1d4ed8,color:#fff
  style L fill:#1e293b,color:#94a3b8
  style T fill:#1e293b,color:#94a3b8
  style W fill:#1e293b,color:#94a3b8
  style Z fill:#16a34a,color:#fff
`

const CUSTOMER_WHATSAPP_JOURNEY = `
flowchart TD
  A([Customer on WhatsApp]) --> B[Send greeting or service intent]
  B --> C[Welcome menu]
  C --> D{Choice}

  D -->|Request a job| E[Category -> name -> suburb/location]
  E --> F[Street address after location]
  F --> G[Availability / confirmation]
  G --> H[(JobRequest created)]
  H --> I[Direct ticket link sent]
  I --> J[/requests/access/:token]

  D -->|Track booking| K[Status flow]
  D -->|Help| L[FAQ / support flow]

  H --> M[Matching engine]
  M --> N[Provider lead broadcast]
  N --> O[Customer later receives quote link or booking updates]

  O --> P{Needs action?}
  P -->|Quote decision| Q[/quotes/:token]
  P -->|Extra work| R[/approve/:token]
  P -->|Ticket view only| J

  style A fill:#25d366,color:#000
  style H fill:#1e293b,color:#94a3b8
  style J fill:#1d4ed8,color:#fff
  style Q fill:#1d4ed8,color:#fff
  style R fill:#1d4ed8,color:#fff
`

const PROVIDER_JOURNEY = `
flowchart TD
  A([Worker / provider]) --> B{Entry path}
  B -->|WhatsApp| C[Registration flow]
  B -->|Approved account| D[/provider-sign-in -> /provider-verify]

  C --> E[Name]
  E --> F[Multi-select skills]
  F --> G[Coverage area by province / city / region]
  G --> H[Experience + availability + evidence note]
  H --> I[(ProviderApplication pending)]
  I --> J[/admin/applications review]
  J -->|Approved| D
  J -->|Rejected| K[Application stays closed / pending follow-up]

  D --> L[/provider]
  L --> M[See active and upcoming jobs]
  L --> N[/provider/leads]
  N --> O[/provider/leads/:leadId]
  O --> P{Accept lead?}
  P -->|Decline| N
  P -->|Accept| Q[/provider/quotes/:matchId]

  Q --> R{Inspection flow or direct quote}
  R --> S[Submit quote]
  S --> T[Customer approves via token link]
  T --> U[(Booking + Job exist)]

  U --> V[/provider/jobs/:id]
  V --> W[Status updates]
  W --> X[Upload work photos]
  X --> Y[Optional extra work request]
  Y --> Z[Customer confirms completion]

  L --> AA[/provider/profile]
  AA --> AB[Skills + service areas + schedule]
  L --> AC[/provider/earnings]

  style A fill:#7c3aed,color:#fff
  style I fill:#1e293b,color:#94a3b8
  style U fill:#1e293b,color:#94a3b8
  style Z fill:#16a34a,color:#fff
`

const ADMIN_OPS_JOURNEY = `
flowchart TD
  A([Owner / Admin]) --> B[admin.plugapro.co.za/sign-in]
  B --> C[/admin]
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

  C --> N[/admin/applications]
  N --> O[Approve / reject provider applications]

  C --> P[/admin/bookings]
  P --> Q[Inspect booking, payment, job, attachments]

  C --> R[/admin/disputes]
  R --> S[Resolve or close disputes]

  C --> T[/admin/payments]
  T --> U[Refunds / payment follow-up]

  C --> V[/admin/locations]
  V --> W[Maintain taxonomy]

  C --> X[/admin/reports]
  X --> Y[Operational summaries]

  style A fill:#123524,color:#fff
  style D fill:#1e293b,color:#94a3b8
  style I fill:#dc2626,color:#fff
`

const TOKENIZED_ACCESS = `
flowchart LR
  A[Scoped public link created] --> B{Link type}
  B -->|Ticket| C[/requests/access/:token]
  B -->|Quote approval| D[/quotes/:token]
  B -->|Extra work approval| E[/approve/:token]

  C --> F[Resolve token -> one job request only]
  F --> G[Render request, provider, quote, booking, photos]
  G --> H[/api/attachments/:id?token=...]

  D --> I[Resolve approvalToken -> one quote only]
  I --> J[Approve or decline]
  J --> K[(Booking + Job creation on approval)]

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
  A[(JobRequest / Match / Booking changes)] --> B[Matching engine]
  B --> C[Lead dispatch]
  C --> D[WhatsApp / push notifications]

  E[Vercel cron] --> F[/api/cron/match-leads]
  E --> G[/api/cron/reminders]
  E --> H[/api/cron/follow-up]
  E --> I[/api/cron/session-timeout]
  E --> J[/api/cron/ops-alerts]

  F --> K[Retry dispatch / reconcile applications]
  G --> L[Booking reminder messages]
  H --> M[Follow-up messages]
  I --> N[Reset stale WhatsApp sessions]
  J --> O[Queue breach detection]
  O --> P[Ops WhatsApp alert]

  Q[Inbound webhooks] --> R[/api/webhooks/whatsapp]
  Q --> S[/api/webhooks/payments]
  R --> T[Conversation routing + dedupe]
  S --> U[Payment state sync]

  style E fill:#123524,color:#fff
  style P fill:#dc2626,color:#fff
  style R fill:#25d366,color:#000
  style S fill:#f59e0b,color:#000
`

const REQUEST_LIFECYCLE = `
flowchart TD
  A[(JobRequest OPEN)] --> B[(JobRequest MATCHING)]
  B --> C{Lead accepted?}
  C -->|No| D[(JobRequest EXPIRED or OPS review)]
  C -->|Yes| E[(Match MATCHED)]

  E --> F{Inspection needed?}
  F -->|Yes| G[(INSPECTION_SCHEDULED)]
  G --> H[(INSPECTION_COMPLETE)]
  H --> I[(Match QUOTED)]
  F -->|No| I

  I --> J{Customer decision}
  J -->|Decline| K[(QUOTE_DECLINED)]
  K --> I
  J -->|Approve| L[(Booking SCHEDULED)]

  L --> M[(Job SCHEDULED)]
  M --> N[(EN_ROUTE)]
  N --> O[(ARRIVED)]
  O --> P[(STARTED)]
  P --> Q[(PAUSED / AWAITING_APPROVAL optional)]
  Q --> P
  P --> R[(PENDING_COMPLETION_CONFIRMATION)]
  R --> S[(COMPLETED)]

  P --> T[(Dispute OPEN)]
  R --> T
  T --> U[(Dispute resolved / booking outcome managed)]

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
    <div>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-bold">Current User Journey Flows</h1>
        <p className="text-sm text-muted-foreground">
          Regenerated from the implemented routes, token access paths, WhatsApp handlers, admin queues,
          and request lifecycle in the current codebase.
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-6 flex-wrap h-auto gap-1">
          {FLOWS.map((flow) => (
            <TabsTrigger key={flow.id} value={flow.id} className="text-xs">
              {flow.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {FLOWS.map((flow) => (
          <TabsContent key={flow.id} value={flow.id} className="space-y-4">
            <div className="rounded-lg border bg-card">
              <div className="border-b px-5 py-3">
                <h2 className="font-semibold">{flow.label}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{flow.description}</p>
              </div>

              <div className="grid gap-4 border-b px-5 py-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Entry Points
                  </h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {flow.entryPoints.map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Why This Matters
                  </h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {flow.outcomes.map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="overflow-x-auto p-4">
                <MermaidDiagram chart={flow.chart} />
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
