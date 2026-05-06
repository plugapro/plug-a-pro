// ─── Admin: Settings ──────────────────────────────────────────────────────────
// Platform configuration — static display, no Business model.

export const revalidate = 60

import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Settings', noIndex: true })

export default async function SettingsPage() {
  await requireAdmin()

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Platform configuration</p>
      </div>

      {/* Read-only platform info */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Platform
        </h2>
        <div className="rounded-xl border bg-card p-4 space-y-3 text-sm">
          <Row label="Mode">P2P Marketplace</Row>
          <Row label="Timezone">{process.env.PLATFORM_TIMEZONE ?? 'Africa/Johannesburg'}</Row>
          <Row label="Currency">{process.env.PLATFORM_CURRENCY ?? 'ZAR'}</Row>
          <Row label="App URL">{process.env.NEXT_PUBLIC_APP_URL ?? '—'}</Row>
        </div>
      </section>

      {/* Job categories */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Job Categories
        </h2>
        <div className="rounded-xl border bg-card p-4 space-y-2 text-sm">
          {[
            'Plumbing',
            'Painting',
            'Garden',
            'Handyman',
            'Appliances',
            'Electrical',
            'DIY',
            'Roofing',
          ].map((cat) => (
            <div key={cat} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
              <span>{cat}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Integration reference */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Integrations
        </h2>
        <div className="rounded-xl border bg-card p-4 space-y-2 text-sm text-muted-foreground">
          <p>
            WhatsApp, payments, storage, and notification settings are configured via
            environment variables. See{' '}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              .env.local.example
            </code>{' '}
            for the full list.
          </p>
        </div>
      </section>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  )
}
