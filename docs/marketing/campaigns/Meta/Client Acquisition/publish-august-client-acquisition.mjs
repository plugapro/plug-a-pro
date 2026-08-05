#!/usr/bin/env node
// Publish the August client-acquisition campaign — PAUSED.
//
// What it creates (nothing is switched on; every object is created PAUSED):
//   - 1 campaign  "PAP | JHB West | Client Acquisition | Aug 2026"
//                  Traffic objective, CBO R150/day. NO special ad category —
//                  this is a customer campaign; copy must never drift into
//                  employment-adjacent wording, which would require one.
//   - 1 ad set    "CJW-Pins-Broad" — four lat/lng pins covering the entire
//                  jhb_west suburb corridor (coordinates from LocationNode).
//                  Matching is fenced to jhb_west (service-area-guard.ts),
//                  so the pins ARE the serviceable area: the creative says
//                  "across Joburg" but only people we can serve see the ad.
//                  Facebook + Instagram placements, mobile devices only
//                  (app.plugapro.co.za serves desktop a no-JS gate).
//   - 1 ad        "CJW-Joburg-Hero-v1" — owner-supplied hero creative
//                  (2026-08-05), four-category grid + how-it-works strip.
//
// Spec: ../2026-08-august-client-acquisition-spec.md. Launch gates G1-G3
// live there; this script only loads the campaign, it does not flip it on.
//
// Usage:
//   node "publish-august-client-acquisition.mjs"           # DRY RUN
//   node "publish-august-client-acquisition.mjs" --apply   # create (PAUSED)
//
// Token: META_ADS_TOKEN env var, falling back to the macOS keychain item.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

function tokenFromKeychain() {
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'META_ADS_TOKEN', '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const TOKEN = process.env.META_ADS_TOKEN || tokenFromKeychain();
const ACT = (process.env.AD_ACCOUNT_ID || 'act_1349941660531643').replace(/^act_?/, 'act_');
const VERSION = process.env.GRAPH_VERSION || 'v21.0';
const PAGE_ID = process.env.PAGE_ID || '1009537752249937';
// @plugapro — pass as instagram_user_id (instagram_actor_id rejects this id).
const IG_ID = process.env.IG_ID || '17841433199181682';
const BASE = `https://graph.facebook.com/${VERSION}`;

const CAMPAIGN_NAME = 'PAP | JHB West | Client Acquisition | Aug 2026';
const ADSET_NAME = 'CJW-Pins-Broad';
const DAILY_BUDGET_CENTS = 15000; // R150/day CBO, per approved spec envelope

// Four pins covering all active jhb_west suburbs (centroids from
// location_nodes, radii chosen so the union covers the corridor and stays
// inside the matching fence — no Krugersdorp/Randfontein/Soweto bleed).
const PINS = [
  { name: 'Roodepoort core',        latitude: -26.1644, longitude: 27.873,  radius: 6 },
  { name: 'Constantia/Northcliff',  latitude: -26.1455, longitude: 27.9262, radius: 5 },
  { name: 'Honeydew/Randpark',      latitude: -26.072,  longitude: 27.925,  radius: 6 },
  { name: 'Ruimsig/Featherbrooke',  latitude: -26.096,  longitude: 27.854,  radius: 5 },
];

const LINK =
  'https://app.plugapro.co.za/?utm_source=meta&utm_medium=paid&utm_campaign=pap_client_acquisition_aug&utm_content=joburg_hero_v1';

const AD = {
  name: 'CJW-Joburg-Hero-v1',
  file: join(HERE, 'plug_a_pro_campaign_fixed_1x1', 'PAP-Client Acquisition-Joburg Hero Aug 2026.png'),
  headline: 'Home help in your area — real quotes online',
  // Customer-problem copy. Positioning rules: marketplace framing
  // ("independent local pros"), no "trusted"/"verified"/"vetted", no
  // employment-adjacent wording.
  body:
    'Plumbing, painting, handyman, cleaning and more — done by independent local pros around Roodepoort, Northcliff, Honeydew and surrounds. Tell us the job, get matched, review real quotes, and follow it all on WhatsApp.',
};

// "Book now" is the CTA this account has used since Meta removed
// "Get Started"; GET_QUOTE is the closest fallback if BOOK_NOW is rejected
// for link ads on this API version.
const CTA_PREFERENCE = ['BOOK_NOW', 'GET_QUOTE', 'LEARN_MORE'];

if (!TOKEN) {
  console.error('ERROR: no token. Set META_ADS_TOKEN or store it in the keychain item META_ADS_TOKEN.');
  process.exit(1);
}

async function gget(path, params = {}) {
  const u = new URL(`${BASE}/${path}`);
  u.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
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

async function uploadImage(absPath) {
  const buf = readFileSync(absPath);
  const form = new FormData();
  form.set('access_token', TOKEN);
  form.set('filename', new Blob([buf], { type: 'image/png' }), basename(absPath));
  const r = await fetch(`${BASE}/${ACT}/adimages`, { method: 'POST', body: form });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`upload: ${JSON.stringify(j.error || j)}`);
  const first = Object.values(j.images || {})[0];
  if (!first?.hash) throw new Error(`upload: no hash in ${JSON.stringify(j)}`);
  return first.hash;
}

async function findResumableCampaign() {
  const j = await gget(`${ACT}/campaigns`, { fields: 'id,name,effective_status', limit: '200' });
  const dup = (j.data || []).find((c) => c.name === CAMPAIGN_NAME && c.effective_status !== 'DELETED');
  if (!dup) return null;
  if (dup.effective_status === 'PAUSED') {
    console.log(`Resuming into existing PAUSED campaign ${dup.id}.`);
    return dup.id;
  }
  throw new Error(`Campaign already exists and is not PAUSED: ${dup.id} (${dup.effective_status}). Aborting.`);
}

async function createCreativeWithCta(hash) {
  let lastErr;
  for (const cta of CTA_PREFERENCE) {
    try {
      const creative = await gpost(`${ACT}/adcreatives`, {
        name: `${AD.name} creative`,
        object_story_spec: {
          page_id: PAGE_ID,
          instagram_user_id: IG_ID,
          link_data: {
            link: LINK,
            message: AD.body,
            name: AD.headline,
            image_hash: hash,
            call_to_action: { type: cta, value: { link: LINK } },
          },
        },
        // Advantage+ creative enhancements are left at API default (the
        // opt-out field is deprecated) — disable them manually in Ads
        // Manager during review, per the June lesson.
      });
      console.log(`   CTA used: ${cta}`);
      return creative;
    } catch (e) {
      lastErr = e;
      console.log(`   CTA ${cta} rejected, trying next…`);
    }
  }
  throw lastErr;
}

async function main() {
  console.log(`Ad account: ${ACT}   mode: ${APPLY ? 'APPLY (creates PAUSED objects)' : 'DRY RUN'}\n`);

  const resumeCampaignId = await findResumableCampaign();

  console.log('PLAN');
  console.log('─'.repeat(96));
  console.log(`Campaign: ${CAMPAIGN_NAME}  [PAUSED, OUTCOME_TRAFFIC, CBO R${DAILY_BUDGET_CENTS / 100}/day, no special category]`);
  console.log(`Ad set:   ${ADSET_NAME}  [PAUSED, LINK_CLICKS, FB+IG, mobile only, age 25-65]`);
  for (const p of PINS) console.log(`   pin:   ${p.name}  (${p.latitude}, ${p.longitude})  r=${p.radius}km`);
  console.log(`Ad:       ${AD.name}  [PAUSED]`);
  console.log(`   image:    ${basename(AD.file)}`);
  console.log(`   headline: ${AD.headline}`);
  console.log(`   body:     ${AD.body}`);
  console.log(`   link:     ${LINK}`);
  console.log('─'.repeat(96));

  if (!APPLY) {
    console.log('\nDRY RUN complete. Nothing was created. Re-run with --apply to create (PAUSED).');
    return;
  }

  console.log('\nAPPLYING…\n');

  const campaign = resumeCampaignId
    ? { id: resumeCampaignId }
    : await gpost(`${ACT}/campaigns`, {
        name: CAMPAIGN_NAME,
        objective: 'OUTCOME_TRAFFIC',
        status: 'PAUSED',
        special_ad_categories: [],
        daily_budget: String(DAILY_BUDGET_CENTS),
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      });
  console.log(`OK campaign ${campaign.id}`);

  const existingSets = resumeCampaignId
    ? (await gget(`${campaign.id}/adsets`, { fields: 'id,name', limit: '50' })).data || []
    : [];
  const priorSet = existingSets.find((s) => s.name === ADSET_NAME);
  const adset = priorSet || (await gpost(`${ACT}/adsets`, {
    name: ADSET_NAME,
    campaign_id: campaign.id,
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LANDING_PAGE_VIEWS',
    targeting: {
      geo_locations: {
        custom_locations: PINS.map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
          radius: p.radius,
          distance_unit: 'kilometer',
        })),
      },
      age_min: 25,
      age_max: 65,
      publisher_platforms: ['facebook', 'instagram'],
      device_platforms: ['mobile'],
      targeting_automation: { advantage_audience: 0 },
    },
  }));
  console.log(`OK ad set ${adset.id}${priorSet ? ' (reused)' : ''}`);

  const existingAds = (await gget(`${adset.id}/ads`, { fields: 'id,name', limit: '50' })).data || [];
  if (existingAds.some((a) => a.name === AD.name)) {
    console.log(`SKIP ad ${AD.name} (already exists)`);
  } else {
    const hash = await uploadImage(AD.file);
    const creative = await createCreativeWithCta(hash);
    const adObj = await gpost(`${ACT}/ads`, {
      name: AD.name,
      adset_id: adset.id,
      status: 'PAUSED',
      creative: { creative_id: creative.id },
    });
    console.log(`OK ad ${AD.name}  ad=${adObj.id}  creative=${creative.id}`);
    try {
      const prev = await gget(`${creative.id}/previews`, { ad_format: 'MOBILE_FEED_STANDARD' });
      const src = prev.data?.[0]?.body?.match(/src="([^"]+)"/)?.[1];
      if (src) console.log(`   FB feed preview: ${src.replace(/&amp;/g, '&')}`);
      const ig = await gget(`${creative.id}/previews`, { ad_format: 'INSTAGRAM_STANDARD' });
      const igSrc = ig.data?.[0]?.body?.match(/src="([^"]+)"/)?.[1];
      if (igSrc) console.log(`   IG feed preview: ${igSrc.replace(/&amp;/g, '&')}`);
    } catch (e) {
      console.log(`   preview unavailable: ${e.message}`);
    }
  }

  console.log('\nDone. Everything is PAUSED — review previews + Advantage+ toggles in Ads Manager, then flip the campaign toggle to go live.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
