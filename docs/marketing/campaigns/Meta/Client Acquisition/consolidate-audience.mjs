#!/usr/bin/env node
// Consolidate the West Rand campaign to ONE broad ad set.
//
// What it does (and does NOT do):
//   - Finds the existing campaign + its ad sets + ads (no new campaign is created).
//   - Picks a "keeper" ad set (default: the one with the most ads; override with KEEPER_MATCH).
//   - Rewrites the keeper's audience to BROAD: keeps its geo_locations (Roodepoort +17km),
//     sets age 25-65, all genders, Advantage+ audience ON, and strips all interest/behaviour
//     (flexible_spec) layering. Renames the keeper (default "WR-Broad-All").
//   - Re-creates every ad that lives in the OTHER ad sets as a PAUSED ad inside the keeper,
//     pointing at the SAME creative (creative_id) — Meta has no "move ad" API, so a copy is
//     the only supported way. Originals are left in place.
//   - Pauses the other (now-redundant) ad sets so all delivery + the campaign budget flow to
//     the single keeper ad set.
//   - Does NOT touch the campaign budget (R150/day CBO stays as-is) or any ad copy/CTA/UTM.
//
// NOTE: a stray UNPUBLISHED "UPDATED: Budget" UI draft exists on WR-CORE-PLANNED. This script
// edits LIVE objects via the API and never publishes that UI draft. If WR-CORE-PLANNED ends up
// paused (not the keeper) the draft is moot; either way, discard it in Ads Manager to be tidy.
//
// Usage:
//   META_ADS_TOKEN=<token with ads_management> node "consolidate-audience.mjs"          # DRY RUN
//   META_ADS_TOKEN=<token> node "consolidate-audience.mjs" --apply                      # perform it
//
// Optional env:
//   AD_ACCOUNT_ID   default act_1349941660531643
//   CAMPAIGN_ID     skip name search and target this campaign id directly
//   CAMPAIGN_MATCH  substring to match campaign name (default "West Rand")
//   KEEPER_MATCH    substring to pick the keeper ad set by name (default: most-ads ad set)
//   KEEPER_NAME     new name for the consolidated ad set (default "WR-Broad-All")
//   AGE_MIN/AGE_MAX default 25 / 65
//   GRAPH_VERSION   default v21.0
//
// Nothing is mutated unless you pass --apply. Review the dry-run plan first.

const APPLY = process.argv.includes('--apply');
const TOKEN = process.env.META_ADS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
const ACT = (process.env.AD_ACCOUNT_ID || 'act_1349941660531643').replace(/^act_?/, 'act_');
const VERSION = process.env.GRAPH_VERSION || 'v21.0';
const CAMPAIGN_ID = process.env.CAMPAIGN_ID || '';
const CAMPAIGN_MATCH = (process.env.CAMPAIGN_MATCH || 'West Rand').toLowerCase();
const KEEPER_MATCH = (process.env.KEEPER_MATCH || '').toLowerCase();
const KEEPER_NAME = process.env.KEEPER_NAME || 'WR-Broad-All';
const AGE_MIN = Number(process.env.AGE_MIN || 25);
const AGE_MAX = Number(process.env.AGE_MAX || 65);
const BASE = `https://graph.facebook.com/${VERSION}`;

if (!TOKEN) {
  console.error('ERROR: set META_ADS_TOKEN to a token with ads_management on the ad account.');
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

async function gpost(path, fields) {
  const body = new URLSearchParams();
  body.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(fields)) body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const r = await fetch(`${BASE}/${path}`, { method: 'POST', body });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`POST ${path}: ${JSON.stringify(j.error || j)}`);
  return j;
}

// Turn an existing targeting object into a broad one (keep geo + placements, drop interests).
function broadenTargeting(targeting) {
  const t = JSON.parse(JSON.stringify(targeting || {}));
  delete t.flexible_spec;
  delete t.interests;
  delete t.behaviors;
  delete t.genders;            // all genders
  delete t.exclusions;         // drop any interest-based exclusions
  t.age_min = AGE_MIN;
  t.age_max = AGE_MAX;
  t.targeting_automation = { ...(t.targeting_automation || {}), advantage_audience: 1 };
  return t;
}

async function resolveCampaignId() {
  if (CAMPAIGN_ID) return CAMPAIGN_ID;
  const j = await gget(`${ACT}/campaigns`, { fields: 'id,name,effective_status,daily_budget,lifetime_budget', limit: '200' });
  const hit = (j.data || []).find((c) => c.name?.toLowerCase().includes(CAMPAIGN_MATCH));
  if (!hit) throw new Error(`No campaign matching "${CAMPAIGN_MATCH}". Set CAMPAIGN_ID explicitly.`);
  const budget = hit.daily_budget ? `R${(hit.daily_budget / 100).toFixed(2)}/day` : (hit.lifetime_budget ? `R${(hit.lifetime_budget / 100).toFixed(2)} lifetime` : 'ad-set budgets');
  console.log(`Campaign: ${hit.name} (${hit.id})  status=${hit.effective_status}  budget=${budget}`);
  return hit.id;
}

async function main() {
  console.log(`Ad account: ${ACT}   mode: ${APPLY ? 'APPLY (will mutate)' : 'DRY RUN'}\n`);
  const campaignId = await resolveCampaignId();

  const adsetsResp = await gget(`${campaignId}/adsets`, {
    fields: 'id,name,status,effective_status,daily_budget,targeting',
    limit: '200',
  });
  const adsets = adsetsResp.data || [];

  const adsResp = await gget(`${campaignId}/ads`, {
    fields: 'id,name,status,adset_id,creative{id,name}',
    limit: '500',
  });
  const ads = adsResp.data || [];

  const adsByAdset = new Map();
  for (const ad of ads) {
    const k = ad.adset_id;
    if (!adsByAdset.has(k)) adsByAdset.set(k, []);
    adsByAdset.get(k).push(ad);
  }

  // choose keeper
  let keeper;
  if (KEEPER_MATCH) {
    keeper = adsets.find((s) => s.name?.toLowerCase().includes(KEEPER_MATCH));
    if (!keeper) throw new Error(`No ad set matching KEEPER_MATCH="${KEEPER_MATCH}".`);
  } else {
    keeper = [...adsets].sort((a, b) => (adsByAdset.get(b.id)?.length || 0) - (adsByAdset.get(a.id)?.length || 0))[0];
  }
  if (!keeper) throw new Error('No ad sets found in campaign.');

  const others = adsets.filter((s) => s.id !== keeper.id);
  const adsToCopy = others.flatMap((s) => adsByAdset.get(s.id) || []);
  const newTargeting = broadenTargeting(keeper.targeting);

  // plan output
  console.log('PLAN');
  console.log('─'.repeat(92));
  console.log(`KEEPER ad set: ${keeper.name} (${keeper.id})`);
  console.log(`  rename -> "${KEEPER_NAME}"`);
  console.log(`  audience -> age ${AGE_MIN}-${AGE_MAX}, all genders, Advantage+ ON, interests/behaviours stripped, geo kept`);
  const geo = newTargeting.geo_locations ? JSON.stringify(newTargeting.geo_locations).slice(0, 120) : '(none?)';
  console.log(`  geo kept: ${geo}`);
  console.log(`  keeps ${adsByAdset.get(keeper.id)?.length || 0} existing ad(s): ${(adsByAdset.get(keeper.id) || []).map((a) => a.name).join(', ') || '(none)'}`);
  console.log('');
  console.log(`COPY ${adsToCopy.length} ad(s) into keeper as PAUSED:`);
  for (const ad of adsToCopy) console.log(`  - "${ad.name}"  creative=${ad.creative?.id}  (from ${adsets.find((s) => s.id === ad.adset_id)?.name})`);
  console.log('');
  console.log(`PAUSE ${others.length} other ad set(s): ${others.map((s) => `${s.name} (${s.id})`).join(', ')}`);
  console.log('─'.repeat(92));
  console.log('(Campaign budget is NOT changed. Ad copy/CTA/UTM/creatives are NOT changed.)');

  if (!APPLY) {
    console.log('\nDRY RUN complete. Nothing was changed. Re-run with --apply to perform the consolidation.');
    return;
  }

  console.log('\nAPPLYING…\n');
  // 1. rewrite keeper audience + name
  try {
    await gpost(`${keeper.id}`, { name: KEEPER_NAME, targeting: newTargeting });
    console.log(`OK  keeper updated: ${keeper.name} -> ${KEEPER_NAME} (broad audience)`);
  } catch (e) { console.log(`FAIL keeper update: ${e.message}`); }

  // 2. copy ads into keeper
  for (const ad of adsToCopy) {
    if (!ad.creative?.id) { console.log(`SKIP "${ad.name}": no creative id`); continue; }
    try {
      const created = await gpost(`${ACT}/ads`, {
        name: ad.name,
        adset_id: keeper.id,
        creative: { creative_id: ad.creative.id },
        status: 'PAUSED',
      });
      console.log(`OK  copied "${ad.name}" -> keeper as ad ${created.id} (PAUSED)`);
    } catch (e) { console.log(`FAIL copy "${ad.name}": ${e.message}`); }
  }

  // 3. pause other ad sets
  for (const s of others) {
    try {
      await gpost(`${s.id}`, { status: 'PAUSED' });
      console.log(`OK  paused ad set ${s.name} (${s.id})`);
    } catch (e) { console.log(`FAIL pause ${s.name}: ${e.message}`); }
  }

  console.log('\nDone. One broad ad set now holds all creatives; redundant ad sets paused. Campaign stays OFF until you flip it on.');
}

main().catch((e) => { console.error(e); process.exit(1); });
