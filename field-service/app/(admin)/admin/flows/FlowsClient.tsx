'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MermaidDiagram } from '@/components/admin/MermaidDiagram'

// ─── Diagram definitions ──────────────────────────────────────────────────────

const CUSTOMER_JOURNEY = `
flowchart TD
  A([Customer]) --> B{Channel?}

  B -->|WhatsApp| C[Text 'Hi' or service keyword]
  B -->|PWA| D[Open app.plugapro.co.za]

  C --> E[Bot: Welcome menu]
  D --> F[Sign in with phone OTP]

  E --> G[Select: Request a job]
  F --> G

  G --> H[Choose service category\ne.g. Plumbing, Electrical]
  H --> I[Describe the problem\nfree-text input]
  I --> J[Confirm address\nsuburb / GPS]
  J --> K[Note availability\ne.g. weekday mornings]
  K --> L[(JobRequest created\nstatus: OPEN)]

  L --> M{Auto-match\nengine}

  M -->|No match found| N[Notify customer:\nwe'll reach out shortly]
  M -->|Match found| O[(Lead sent to provider\nstatus: SENT)]

  O --> P{Provider responds}
  P -->|Declines| Q[Try next provider]
  Q --> O
  P -->|Accepts| R[(Match created\nstatus: MATCHED)]

  R --> S{Inspection\nneeded?}
  S -->|Yes| T[Provider proposes\ninspection slot]
  T --> U[Customer confirms slot]
  U --> V[Inspection completed\nphotos uploaded]
  V --> W[Provider submits Quote]
  S -->|No| W

  W --> X[Quote sent to customer\nvia WhatsApp link]
  X --> Y{Customer decision}
  Y -->|Declines / asks revision| Z[Provider revises quote]
  Z --> X
  Y -->|Approves| AA[(Booking created\nstatus: SCHEDULED)]

  AA --> AB[Payment link sent\nPeach / Yoco checkout]
  AB --> AC{Payment}
  AC -->|Failed| AD[Retry or contact support]
  AC -->|Paid| AE[(Payment PAID\nPayout PENDING)]

  AE --> AF[Provider executes job\nsee Provider Journey]
  AF --> AG{Job outcome}
  AG -->|Issue raised| AH[(Dispute opened)]
  AH --> AI[Admin mediates]
  AI --> AJ[Resolved]
  AG -->|Completed OK| AK[Customer confirms\ncompletion]

  AK --> AL[Leave a review\n1–5 stars + comment]
  AL --> AM([Journey complete])

  style A fill:#1d4ed8,color:#fff
  style AM fill:#16a34a,color:#fff
  style AH fill:#dc2626,color:#fff
  style L fill:#1e293b,color:#94a3b8
  style O fill:#1e293b,color:#94a3b8
  style R fill:#1e293b,color:#94a3b8
  style AA fill:#1e293b,color:#94a3b8
  style AE fill:#1e293b,color:#94a3b8
`

const PROVIDER_JOURNEY = `
flowchart TD
  A([Provider]) --> B[Text WhatsApp\nregistration keyword]
  B --> C[Bot: Registration flow]

  C --> D[Enter name]
  D --> E[Select skills\ne.g. Plumbing, Electrical]
  E --> F[Enter service areas\ne.g. Sandton, Randburg]
  F --> G[Years of experience]
  G --> H[Available days & hours]
  H --> I[(ProviderApplication\nstatus: PENDING)]

  I --> J{Admin review}
  J -->|Rejected| K[WhatsApp: Application declined]
  J -->|Approved| L[(Provider account created\nactive + verified)]

  L --> M[Receive job lead\nvia WhatsApp]
  M --> N[View: title, location,\ndescription, category]
  N --> O{Decision}
  O -->|Decline| P[Lead marked DECLINED\nnext provider tried]
  O -->|Accept| Q[(Match created\nstatus: MATCHED)]

  Q --> R{Inspection\nrequired?}
  R -->|Yes| S[Propose inspection slot\ndate + time window]
  S --> T[Customer confirms]
  T --> U[Conduct site visit\nupload photos]
  U --> V[Submit formal Quote\namount + description]
  R -->|No| V

  V --> W[Await customer\napproval]
  W --> X{Quote approved?}
  X -->|Revision requested| Y[Update quote]
  Y --> W
  X -->|Approved| Z[(Booking confirmed\nsee it in /technician/jobs)]

  Z --> AA[Job day arrives]
  AA --> AB[Update status: EN_ROUTE]
  AB --> AC[Arrive on site\nstatus: ARRIVED]
  AC --> AD[Start work\nstatus: STARTED]
  AD --> AE{Extra work\nneeded?}
  AE -->|Yes| AF[Create extra work request\ncustomer approves via link]
  AF --> AG{Customer approves?}
  AG -->|No| AH[Proceed without extras]
  AG -->|Yes| AI[Extras added to invoice]
  AH --> AJ[Complete job\nupload before/after photos]
  AI --> AJ
  AE -->|No| AJ

  AJ --> AK[(Job: PENDING_COMPLETION_CONFIRMATION)]
  AK --> AL[Customer confirms\ncompletion]
  AL --> AM[(Payment released\nPayout: PROCESSING)]
  AM --> AN[Bank transfer received\nPayout: PAID]
  AN --> AO([Journey complete — get paid!])

  style A fill:#7c3aed,color:#fff
  style AO fill:#16a34a,color:#fff
  style I fill:#1e293b,color:#94a3b8
  style L fill:#1e293b,color:#94a3b8
  style Q fill:#1e293b,color:#94a3b8
  style Z fill:#1e293b,color:#94a3b8
  style AK fill:#1e293b,color:#94a3b8
  style AM fill:#1e293b,color:#94a3b8
`

const WHATSAPP_BOT = `
flowchart TD
  IN([Inbound WhatsApp message]) --> LOAD[Load conversation state\nphone → flow + step + data]
  LOAD --> KW{Reset keyword?\nhi · hello · menu · start}
  KW -->|Yes| WELCOME[Send welcome menu]
  WELCOME --> SAVE[Save: flow=idle step=welcome]

  KW -->|No| DISPATCH{Route to active flow}

  DISPATCH -->|flow=idle| IDLE{Menu selection}
  IDLE -->|Request a job| JR_CAT[Send category list]
  IDLE -->|Track my booking| ST_SHOW[Show booking status]
  IDLE -->|Become a provider| REG_NAME[Ask for name]
  IDLE -->|Help| HELP_MENU[Send FAQ menu]

  JR_CAT --> JR_DESC[Ask: describe the problem]
  JR_DESC --> JR_ADDR[Ask: confirm address]
  JR_ADDR --> JR_AVAIL[Ask: availability note]
  JR_AVAIL --> JR_CONFIRM[Send confirmation summary\nwith Confirm / Edit buttons]
  JR_CONFIRM -->|Confirm| JR_SUBMIT[(Create JobRequest\nNotify matching engine)]
  JR_CONFIRM -->|Edit| JR_CAT
  JR_SUBMIT --> JR_DONE[Message: request received\nwe'll match you shortly]

  REG_NAME --> REG_SKILLS[Send skills list\nmulti-select]
  REG_SKILLS --> REG_AREA[Ask: service areas]
  REG_AREA --> REG_EXP[Ask: years experience]
  REG_EXP --> REG_AVAIL[Ask: available days]
  REG_AVAIL --> REG_CONFIRM[Send application summary]
  REG_CONFIRM -->|Confirm| REG_SUBMIT[(Create ProviderApplication\nstatus: PENDING)]
  REG_SUBMIT --> REG_DONE[Message: application received\nadmin will review within 24h]

  DISPATCH -->|flow=provider_job| PROV{Provider job step}
  PROV -->|tech_job_view| PROV_ACTION{Accept or Decline?}
  PROV_ACTION -->|Accept| PROV_ACCEPT[(Lead ACCEPTED\nMatch created)]
  PROV_ACTION -->|Decline| PROV_DECLINE[(Lead DECLINED)]
  PROV_ACCEPT --> PROV_NOTIFY[Notify customer of match]

  DISPATCH -->|flow=reschedule| RESC_REASON[Ask: reason for reschedule]
  RESC_REASON --> RESC_SLOT[Propose new slot]
  RESC_SLOT --> RESC_CONFIRM[Confirm reschedule]
  RESC_CONFIRM --> RESC_DONE[(Booking updated)]

  DISPATCH -->|flow=cancel| CANCEL_CONFIRM{Confirm cancel?}
  CANCEL_CONFIRM -->|Yes| CANCEL_DONE[(Booking CANCELLED)]
  CANCEL_CONFIRM -->|No| CANCEL_ABORT[Keep booking as-is]

  JR_DONE --> SAVE2[Save conversation state]
  REG_DONE --> SAVE2
  PROV_NOTIFY --> SAVE2
  RESC_DONE --> SAVE2
  CANCEL_DONE --> SAVE2
  ST_SHOW --> SAVE2
  SAVE2 --> OUT([Reply sent])

  style IN fill:#25d366,color:#000
  style OUT fill:#25d366,color:#000
  style JR_SUBMIT fill:#1e293b,color:#94a3b8
  style REG_SUBMIT fill:#1e293b,color:#94a3b8
  style PROV_ACCEPT fill:#1e293b,color:#94a3b8
  style PROV_DECLINE fill:#dc2626,color:#fff
  style CANCEL_DONE fill:#dc2626,color:#fff
  style RESC_DONE fill:#1e293b,color:#94a3b8
`

const JOB_STATE_MACHINE = `
stateDiagram-v2
  [*] --> OPEN : JobRequest created

  OPEN --> MATCHING : matching engine triggered
  MATCHING --> MATCHED : provider accepts lead
  MATCHING --> EXPIRED : no provider found

  MATCHED --> INSPECTION_SCHEDULED : provider proposes slot
  MATCHED --> QUOTED : skip inspection
  INSPECTION_SCHEDULED --> INSPECTION_COMPLETE : inspection done
  INSPECTION_COMPLETE --> QUOTED : provider submits quote

  QUOTED --> QUOTE_APPROVED : customer approves
  QUOTED --> QUOTE_DECLINED : customer declines
  QUOTE_DECLINED --> QUOTED : provider revises

  QUOTE_APPROVED --> SCHEDULED : booking + payment confirmed

  SCHEDULED --> EN_ROUTE : provider en route
  EN_ROUTE --> ARRIVED : provider on site
  ARRIVED --> STARTED : work started
  STARTED --> PAUSED : waiting for materials
  PAUSED --> STARTED : materials arrived
  STARTED --> AWAITING_APPROVAL : extra work requested
  AWAITING_APPROVAL --> STARTED : customer approves
  AWAITING_APPROVAL --> STARTED : customer declines
  STARTED --> PENDING_COMPLETION_CONFIRMATION : provider marks done
  PENDING_COMPLETION_CONFIRMATION --> COMPLETED : customer confirms
  PENDING_COMPLETION_CONFIRMATION --> FAILED : dispute raised
  COMPLETED --> [*]
  FAILED --> [*]
  EXPIRED --> [*]
  CANCELLED --> [*]

  MATCHED --> CANCELLED : customer or provider cancels
  QUOTED --> CANCELLED : customer cancels
  SCHEDULED --> CANCELLED : customer cancels
`

const PAYMENT_FLOW = `
flowchart LR
  A([Customer approves quote]) --> B[(Booking created\nstatus: SCHEDULED)]
  B --> C[Platform generates\npayment link]
  C --> D{PSP Provider\nPeach Payments / Yoco}

  D -->|Customer pays| E[(Payment\nstatus: AUTHORISED)]
  D -->|Payment fails| F[Retry / contact support]
  F --> D

  E --> G[PSP webhook fires\nPOST /api/webhooks/payments]
  G --> H{Verify webhook\nsignature}
  H -->|Invalid| I[Reject — log security event]
  H -->|Valid| J[(Payment status → PAID\npaidAt recorded)]

  J --> K[(ProviderPayout created\nstatus: PENDING\ngrossAmount = booking quote)]
  K --> L[Admin triggers payout\nor scheduled batch]
  L --> M[(Payout → PROCESSING)]
  M --> N[Bank transfer\nvia EFT / PayFast split]
  N -->|Transfer confirmed| O[(Payout → PAID\nnetAmount = gross − commission\nreference recorded)]
  N -->|Transfer fails| P[(Payout → FAILED)]
  P --> Q[Manual retry by admin]
  Q --> N

  O --> R([Provider receives funds])

  style A fill:#1d4ed8,color:#fff
  style R fill:#16a34a,color:#fff
  style I fill:#dc2626,color:#fff
  style P fill:#dc2626,color:#fff
  style J fill:#1e293b,color:#94a3b8
  style K fill:#1e293b,color:#94a3b8
  style O fill:#1e293b,color:#94a3b8
`

const PLATFORM_OVERVIEW = `
flowchart TB
  subgraph Customers
    CW[WhatsApp]
    CP[PWA — app.plugapro.co.za]
  end

  subgraph Providers
    PW[WhatsApp]
    PP[PWA — /technician]
  end

  subgraph Admin
    AP[Admin dashboard\n/admin]
  end

  subgraph Platform Core
    WH[Webhook handler\n/api/webhooks/whatsapp]
    BOT[WhatsApp Bot\nConversation state machine]
    MATCH[Matching engine\nskills × service area]
    NOTIF[Notifications\nWhatsApp templates + Push]
    CRON[Cron jobs\nreminders · follow-ups]
  end

  subgraph Data
    DB[(Supabase / Postgres\nPrisma ORM)]
    BLOB[(Vercel Blob\nPhotos + attachments)]
  end

  subgraph Payments
    PSP[Peach Payments\nYoco]
    PWEB[Payment webhook\n/api/webhooks/payments]
  end

  CW -->|Inbound message| WH
  WH --> BOT
  BOT --> DB
  BOT -->|Outbound message| CW

  CP -->|API calls| DB
  CP -->|Job request| MATCH
  PP -->|Status updates\nPhoto uploads| DB
  PP -->|Photo uploads| BLOB
  PW -->|Lead accept / decline| WH

  MATCH -->|Lead broadcast| NOTIF
  NOTIF -->|WhatsApp template| PW
  NOTIF -->|Push notification| CP

  AP -->|Approve providers\nDispatch\nMonitor| DB
  AP -->|Manual payout| PSP

  DB -->|Booking confirmed| PSP
  PSP -->|Payment event| PWEB
  PWEB --> DB

  CRON -->|Reminders| NOTIF
  CRON -->|Slot management| DB

  style CW fill:#25d366,color:#000
  style PW fill:#25d366,color:#000
  style DB fill:#1e293b,color:#94a3b8
  style BLOB fill:#1e293b,color:#94a3b8
  style PSP fill:#f59e0b,color:#000
`

// ─── Tab config ───────────────────────────────────────────────────────────────

const FLOWS = [
  {
    id: 'overview',
    label: 'Platform Overview',
    description: 'How all actors and systems connect',
    chart: PLATFORM_OVERVIEW,
  },
  {
    id: 'customer',
    label: 'Customer Journey',
    description: 'From first message through job completion and review',
    chart: CUSTOMER_JOURNEY,
  },
  {
    id: 'provider',
    label: 'Provider Journey',
    description: 'From application and onboarding through job execution and payout',
    chart: PROVIDER_JOURNEY,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp Bot',
    description: 'Conversation state machine — all flows and transitions',
    chart: WHATSAPP_BOT,
  },
  {
    id: 'job-states',
    label: 'Job State Machine',
    description: 'Every status a job can hold and how it transitions',
    chart: JOB_STATE_MACHINE,
  },
  {
    id: 'payments',
    label: 'Payment Flow',
    description: 'Customer payment through to provider payout',
    chart: PAYMENT_FLOW,
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function FlowsClient() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">User Journey Flows</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visual diagrams of every journey through the Plug-A-Pro marketplace
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-6 flex-wrap h-auto gap-1">
          {FLOWS.map((f) => (
            <TabsTrigger key={f.id} value={f.id} className="text-xs">
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {FLOWS.map((f) => (
          <TabsContent key={f.id} value={f.id}>
            <div className="rounded-lg border bg-card">
              <div className="border-b px-5 py-3">
                <h2 className="font-semibold">{f.label}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
              </div>
              <div className="p-4 overflow-x-auto">
                <MermaidDiagram chart={f.chart} />
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
