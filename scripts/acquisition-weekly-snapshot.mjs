#!/usr/bin/env node
/**
 * Weekly acquisition snapshot — Meta Ads + platform funnel, one fixed metric set.
 *
 * The point of this script is comparability: every week must be measured the same
 * way, so the metric definitions live here rather than in a prompt. Read-only.
 *
 *   node scripts/acquisition-weekly-snapshot.mjs            # last 7 days
 *   node scripts/acquisition-weekly-snapshot.mjs --days 14
 *   node scripts/acquisition-weekly-snapshot.mjs --json     # machine-readable
 *
 * Credentials are read from the macOS keychain and never printed:
 *   - Meta:     keychain service "META_ADS_TOKEN"  (or $META_ADS_TOKEN)
 *   - Supabase: keychain service "Supabase CLI"    (go-keyring-base64 prefixed)
 *
 * GA4 (G-R3RH07RQ3G) is NOT included: there is no Data API service account on this
 * machine, and as of 2026-07-28 the property has zero key events configured, so it
 * cannot report conversions anyway. Fill the GA block in by hand until both are fixed.
 */
import { execFileSync } from 'node:child_process'

const AD_ACCOUNT = process.env.PAP_AD_ACCOUNT || 'act_1349941660531643'
const SUPABASE_PROJECT = process.env.PAP_SUPABASE_PROJECT || 'oghbryokdizklgwaqksp'
const GRAPH_VERSION = 'v21.0'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const days = Number(args[args.indexOf('--days') + 1]) || 7

function keychain(service) {
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
}

function metaToken() {
  const t = process.env.META_ADS_TOKEN?.trim() || keychain('META_ADS_TOKEN')
  if (!t) throw new Error('No Meta token: set $META_ADS_TOKEN or keychain service META_ADS_TOKEN')
  return t
}

function supabaseToken() {
  const raw = keychain('Supabase CLI')
  if (!raw) throw new Error('No Supabase CLI token in keychain')
  const stripped = raw.replace(/^go-keyring-base64:/, '')
  return raw.startsWith('go-keyring-base64:')
    ? Buffer.from(stripped, 'base64').toString('utf8').trim()
    : stripped
}

// ── date window ───────────────────────────────────────────────────────────────
// Whole days ending yesterday, so a partial "today" never skews a week's numbers.
function window(nDays) {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (nDays - 1))
  const iso = (d) => d.toISOString().slice(0, 10)
  return { since: iso(start), until: iso(end) }
}

const { since, until } = window(days)

// ── Meta ──────────────────────────────────────────────────────────────────────
const META_TOKEN = metaToken()

async function graph(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('access_token', META_TOKEN)
  const res = await fetch(url)
  const body = await res.json()
  if (body.error) {
    throw new Error(`${path}: ${body.error.code} ${body.error.message}`)
  }
  return body
}

function actionMap(row) {
  return Object.fromEntries((row.actions || []).map((a) => [a.action_type, Number(a.value)]))
}

async function metaSnapshot() {
  const timeRange = JSON.stringify({ since, until })

  const campaigns = await graph(`${AD_ACCOUNT}/campaigns`, {
    fields: 'id,name,effective_status,objective,daily_budget,special_ad_categories',
    limit: '100',
  })

  const insights = await graph(`${AD_ACCOUNT}/insights`, {
    time_range: timeRange,
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cpc,frequency,actions',
    limit: '100',
  })

  const byAd = await graph(`${AD_ACCOUNT}/insights`, {
    time_range: timeRange,
    level: 'ad',
    fields: 'campaign_name,ad_name,spend,impressions,clicks,ctr,cpc,actions',
    limit: '200',
  })

  const statusById = Object.fromEntries(
    campaigns.data.map((c) => [c.id, { status: c.effective_status, cats: c.special_ad_categories }]),
  )

  const rows = insights.data.map((r) => {
    const a = actionMap(r)
    return {
      campaign: r.campaign_name,
      status: statusById[r.campaign_id]?.status ?? 'UNKNOWN',
      specialCategories: statusById[r.campaign_id]?.cats ?? [],
      spend: Number(r.spend),
      impressions: Number(r.impressions),
      reach: Number(r.reach),
      clicks: Number(r.clicks),
      ctr: Number(r.ctr),
      cpc: Number(r.cpc),
      landingPageViews: a.landing_page_view ?? 0,
      messagingConnections: a['onsite_conversion.total_messaging_connection'] ?? 0,
    }
  })

  return {
    campaigns: rows,
    totalSpend: rows.reduce((s, r) => s + r.spend, 0),
    // Concentration check: CBO routinely collapses onto one creative. If the top ad
    // holds most of the spend you are testing one message, not the whole set.
    ads: byAd.data
      .map((r) => ({
        campaign: r.campaign_name,
        ad: r.ad_name,
        spend: Number(r.spend),
        clicks: Number(r.clicks),
        ctr: Number(r.ctr),
        cpc: Number(r.cpc),
        landingPageViews: actionMap(r).landing_page_view ?? 0,
      }))
      .filter((r) => r.spend > 0)
      .sort((a, b) => b.spend - a.spend),
    liveCampaigns: campaigns.data
      .filter((c) => c.effective_status === 'ACTIVE')
      .map((c) => ({ name: c.name, cats: c.special_ad_categories })),
  }
}

// ── platform DB ───────────────────────────────────────────────────────────────
const SUPABASE_TOKEN = supabaseToken()

async function sql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  )
  const body = await res.json()
  if (body.message) throw new Error(`SQL failed: ${body.message}`)
  return body
}

async function funnelSnapshot() {
  const from = `'${since}'`
  const to = `'${until} 23:59:59'`

  const [drafts] = await sql(`
    select count(*)::int as drafts,
           count(*) filter (where "submittedApplicationId" is not null)::int as submitted
    from provider_application_drafts
    where "createdAt" between ${from} and ${to};
  `)

  // Where drafts are parked right now (all time, not windowed) — the standing
  // backlog matters more than the weekly delta for spotting a stuck step.
  const steps = await sql(`
    select "lastCompletedStep"::int as step, count(*)::int as n
    from provider_application_drafts
    where "createdAt" >= '2026-07-13'
    group by 1 order by 1;
  `)

  const apps = await sql(`
    select status::text, count(*)::int as n
    from provider_applications
    where "submittedAt" between ${from} and ${to}
      and coalesce("isTestUser", false) = false
    group by 1 order by 2 desc;
  `)

  // Matchable = approved AND has at least one active service area. An approved
  // provider with no service area can never receive a job (the PJ-01 bug class).
  const [matchable] = await sql(`
    select count(*)::int as approved,
           count(*) filter (where exists (
             select 1 from technician_service_areas t
             where t."providerId" = p.id and t.active
           ))::int as matchable
    from provider_applications a
    join providers p on p.id = a."providerId"
    where a.status = 'APPROVED'
      and a."submittedAt" between ${from} and ${to}
      and coalesce(a."isTestUser", false) = false;
  `)

  const [supply] = await sql(`
    select count(*)::int as active_providers,
           count(*) filter (where exists (
             select 1 from technician_service_areas t
             where t."providerId" = p.id and t.active
           ))::int as matchable_providers
    from providers p
    where p."archivedAt" is null and p.active;
  `)

  const [demand] = await sql(`
    select count(*)::int as job_requests,
           count(*) filter (where "utmSource" is not null)::int as with_utm,
           count(distinct "customerId")::int as customers
    from job_requests
    where "createdAt" between ${from} and ${to}
      and coalesce("isTestRequest", false) = false;
  `)

  return { drafts, steps, apps, matchable, supply, demand }
}

// ── report ────────────────────────────────────────────────────────────────────
const rand = (n) => `R${n.toFixed(2)}`
const per = (spend, n) => (n > 0 ? rand(spend / n) : 'n/a')

const [meta, funnel] = await Promise.all([metaSnapshot(), funnelSnapshot()])

if (asJson) {
  console.log(JSON.stringify({ since, until, days, meta, funnel }, null, 2))
  process.exit(0)
}

const spend = meta.totalSpend
const out = []
out.push(`# Acquisition snapshot — ${since} to ${until} (${days}d)`)
out.push('')
out.push('## Spend')
out.push('| Campaign | Status | Spend | CTR | CPC | LPV |')
out.push('|---|---|---|---|---|---|')
for (const c of meta.campaigns) {
  out.push(
    `| ${c.campaign} | ${c.status} | ${rand(c.spend)} | ${c.ctr.toFixed(2)}% | ${rand(c.cpc)} | ${c.landingPageViews} |`,
  )
}
out.push(`| **Total** | | **${rand(spend)}** | | | |`)
out.push('')

const topAd = meta.ads[0]
if (topAd && spend > 0) {
  const share = ((topAd.spend / spend) * 100).toFixed(0)
  out.push(`Top ad: **${topAd.ad}** — ${rand(topAd.spend)} (${share}% of spend)`)
  if (Number(share) > 60) out.push(`> ⚠️  Budget concentrated on one creative — the other ads are not being tested.`)
  out.push('')
}

const uncategorised = meta.liveCampaigns.filter(
  (c) => /provider|recruit|wanted|onboard/i.test(c.name) && !(c.cats || []).includes('EMPLOYMENT'),
)
if (uncategorised.length) {
  out.push(
    `> ⚠️  Live recruitment campaign(s) without \`special_ad_categories=EMPLOYMENT\`: ${uncategorised
      .map((c) => c.name)
      .join(', ')}`,
  )
  out.push('')
}

out.push('## Provider funnel')
out.push('| Stage | Count | Cost each |')
out.push('|---|---|---|')
out.push(`| Drafts started | ${funnel.drafts.drafts} | ${per(spend, funnel.drafts.drafts)} |`)
out.push(`| Applications submitted | ${funnel.drafts.submitted} | ${per(spend, funnel.drafts.submitted)} |`)
out.push(`| Approved | ${funnel.matchable.approved} | ${per(spend, funnel.matchable.approved)} |`)
out.push(`| **Matchable** (approved + service area) | **${funnel.matchable.matchable}** | **${per(spend, funnel.matchable.matchable)}** |`)
out.push('')

const gap = funnel.matchable.approved - funnel.matchable.matchable
if (gap > 0) {
  out.push(`> ⚠️  ${gap} approved provider(s) have no active service area — they cannot receive a job.`)
  out.push('')
}

out.push('### Draft backlog by step (since 2026-07-13)')
const stepNames = {
  0: 'start', 1: 'profile', 2: 'services', 3: 'area', 4: 'availability',
  5: 'verify', 6: 'evidence ⟵', 7: 'review', 8: 'review (complete)',
}
out.push('| Step completed | Next step | Parked |')
out.push('|---|---|---|')
for (const s of funnel.steps) {
  out.push(`| ${s.step} | ${stepNames[s.step] ?? '?'} | ${s.n} |`)
}
out.push('')

out.push('## Demand')
out.push('| Metric | Count |')
out.push('|---|---|')
out.push(`| Job requests | ${funnel.demand.job_requests} |`)
out.push(`| ...with UTM attribution | ${funnel.demand.with_utm} |`)
out.push(`| Distinct customers | ${funnel.demand.customers} |`)
out.push('')
out.push('## Standing supply')
out.push(`Active providers: ${funnel.supply.active_providers} · Matchable: ${funnel.supply.matchable_providers}`)
out.push('')
out.push('## GA4 — fill in by hand')
out.push('Property `G-R3RH07RQ3G`. Sessions · Paid Social share · `/provider/register` sessions · **key events**.')
out.push('Once key events are configured, sessions→draft conversion becomes measurable here instead of inferred.')

console.log(out.join('\n'))
