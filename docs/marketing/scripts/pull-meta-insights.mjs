#!/usr/bin/env node
// Plug A Pro — pull Meta Ads + Pixel insights for the daily ads conversion report.
//
// Purpose: replace the manual Ads-Manager-screenshot workflow with a single
//          script that prints the same numbers the daily report expects.
//
// What it does (read-only):
//   - Ad-account-level: spend, impressions, reach, clicks, CTR, CPM, CPC,
//     landing-page views, messaging conversations started, results, results-rate
//   - Per-campaign breakdown (West Rand Customer Acquisition + Provider Recruitment)
//   - Per-ad creative breakdown for the LIVE/PAUSED ads (so creative-level CPL
//     can be read at a glance — assumes per-ad utm_content tagging is in place)
//   - Optional: comments + reactions on the page posts attached to ads
//
// Usage:
//   META_ADS_TOKEN=<system-user-token> node docs/marketing/scripts/pull-meta-insights.mjs
//   META_ADS_TOKEN=<...> SINCE=2026-06-15 UNTIL=2026-06-16 node ... pull-meta-insights.mjs
//   META_ADS_TOKEN=<...> WITH_COMMENTS=1 node ... pull-meta-insights.mjs
//
// Alternative — CSV ingest fallback (no token needed):
//   CSV=path/to/ads-manager-export.csv node ... pull-meta-insights.mjs
//   The CSV must include columns: Campaign name, Ad set name, Ad name,
//   Amount spent, Impressions, Reach, Link clicks, Landing page views,
//   Results, Cost per result.

const TOKEN = process.env.META_ADS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
const ACT = (process.env.AD_ACCOUNT_ID || 'act_1349941660531643').replace(/^act_?/, 'act_');
const VERSION = process.env.GRAPH_VERSION || 'v21.0';
const CAMPAIGN_MATCH = (process.env.CAMPAIGN_MATCH || 'West Rand').toLowerCase();
const SINCE = process.env.SINCE; // YYYY-MM-DD optional
const UNTIL = process.env.UNTIL; // YYYY-MM-DD optional
const WITH_COMMENTS = process.env.WITH_COMMENTS === '1';
const CSV = process.env.CSV;
const BASE = `https://graph.facebook.com/${VERSION}`;

if (CSV) {
  await ingestCsv(CSV);
  process.exit(0);
}

if (!TOKEN) {
  console.error('ERROR: set META_ADS_TOKEN (PAP Ops Bot system-user token with ads_read).');
  console.error('Or pass CSV=path/to/export.csv to ingest a Meta Ads Manager CSV export instead.');
  process.exit(1);
}

async function gget(path, params = {}) {
  const u = new URL(`${BASE}/${path}`);
  u.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`GET ${path}: ${JSON.stringify(j.error || j)}`);
  return j;
}

function timeRange() {
  if (!SINCE || !UNTIL) return undefined;
  return JSON.stringify({ since: SINCE, until: UNTIL });
}

async function listCampaigns() {
  const j = await gget(`${ACT}/campaigns`, {
    fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget',
    limit: '200',
  });
  return (j.data || []).filter((c) =>
    c.name?.toLowerCase().includes(CAMPAIGN_MATCH) ||
    c.name?.toLowerCase().includes('provider recruitment') ||
    c.name?.toLowerCase().includes('skilled with your hands'),
  );
}

async function insightsFor(level, id) {
  const params = {
    fields: 'spend,impressions,reach,clicks,ctr,cpc,cpm,actions,action_values,cost_per_action_type,cost_per_inline_link_click,inline_link_clicks',
    level,
  };
  const range = timeRange();
  if (range) params.time_range = range;
  else params.date_preset = 'today';

  const j = await gget(`${id}/insights`, params);
  return (j.data && j.data[0]) || null;
}

function pickAction(actions, type) {
  if (!Array.isArray(actions)) return undefined;
  const hit = actions.find((a) => a.action_type === type);
  return hit ? Number(hit.value) : undefined;
}

function row(label, ins) {
  if (!ins) return console.log(`${label.padEnd(40)} (no data)`);
  const spend = Number(ins.spend || 0);
  const impressions = Number(ins.impressions || 0);
  const reach = Number(ins.reach || 0);
  const lpv = pickAction(ins.actions, 'landing_page_view') ?? 0;
  const conv = pickAction(ins.actions, 'onsite_conversion.messaging_conversation_started_7d') ?? 0;
  const clicks = Number(ins.inline_link_clicks || ins.clicks || 0);
  const cpm = Number(ins.cpm || 0);
  const ctr = Number(ins.ctr || 0);
  console.log(
    label.padEnd(40),
    `spend=R${spend.toFixed(2)}`.padEnd(16),
    `impr=${impressions}`.padEnd(13),
    `reach=${reach}`.padEnd(13),
    `clicks=${clicks}`.padEnd(12),
    `lpv=${lpv}`.padEnd(8),
    `convos=${conv}`.padEnd(11),
    `CTR=${ctr.toFixed(2)}%`.padEnd(11),
    `CPM=R${cpm.toFixed(2)}`,
  );
}

async function main() {
  console.log(`Ad account: ${ACT}`);
  console.log(`Window:     ${SINCE && UNTIL ? `${SINCE} → ${UNTIL}` : 'TODAY (Meta preset)'}`);
  console.log('');

  const campaigns = await listCampaigns();
  if (!campaigns.length) {
    console.error(`No campaigns matched "${CAMPAIGN_MATCH}". Try CAMPAIGN_MATCH="<name>".`);
    process.exit(1);
  }

  for (const c of campaigns) {
    console.log(`\nCAMPAIGN  ${c.name}  (${c.id})  ${c.effective_status}  objective=${c.objective}`);
    const c_ins = await insightsFor('campaign', c.id);
    row('  campaign total', c_ins);

    const adsResp = await gget(`${c.id}/ads`, { fields: 'id,name,status,effective_status,creative{id,name}', limit: '200' });
    for (const ad of adsResp.data || []) {
      const a_ins = await insightsFor('ad', ad.id);
      row(`  ad: ${ad.name.slice(0, 36)}`, a_ins);
      if (WITH_COMMENTS) await dumpComments(ad);
    }
  }
}

async function dumpComments(ad) {
  // For each ad, find the post backing the creative and pull comments.
  try {
    const cr = await gget(`${ad.creative.id}`, { fields: 'effective_object_story_id,object_story_id' });
    const postId = cr.effective_object_story_id || cr.object_story_id;
    if (!postId) return;
    const cj = await gget(`${postId}/comments`, { fields: 'message,from,created_time,like_count', limit: '50' });
    const comments = cj.data || [];
    if (!comments.length) return;
    console.log(`    comments on ${postId}: ${comments.length}`);
    for (const c of comments.slice(0, 15)) {
      const msg = (c.message || '').replace(/\s+/g, ' ').slice(0, 120);
      console.log(`      • ${c.created_time}  ${msg}`);
    }
  } catch (e) {
    // page-token might not have permission on this post — skip silently
  }
}

async function ingestCsv(path) {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(path, 'utf8');
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  console.log('Columns:', headers.join(' | '));
  for (const line of lines) {
    // naive CSV split — replace with `csv-parse` for production
    const cells = line.match(/(\".*?\"|[^,]*)(?=,|$)/g)?.map((c) => c.replace(/^"|"$/g, '')) || [];
    const row = Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
    const campaign = row['Campaign name'] || row['Campaign Name'];
    const spend = row['Amount spent (ZAR)'] || row['Amount spent'] || '0';
    const impr = row['Impressions'] || '0';
    const lpv = row['Landing page views'] || row['Landing Page Views'] || '0';
    const results = row['Results'] || '0';
    const cpr = row['Cost per result'] || row['Cost per Result'] || '';
    console.log(`${(campaign || '?').padEnd(40)} spend=R${spend}  impr=${impr}  LPV=${lpv}  results=${results}  CPR=${cpr}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
