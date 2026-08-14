#!/usr/bin/env node
// Fix Meta review error #2446035 on the August client-acquisition ad:
//   "asset feed invalid target rule count for format: INSTAGRAM_STORY —
//    3 target rule(s) ... exactly 1 expected"
//
// ROOT CAUSE: the v3 creative customised BOTH the image AND the body per
// placement (4 asset_customization_rules). Meta's asset-feed validator
// requires exactly one rule per format; combining per-image + per-body rules
// across the vertical placements makes it count 3 rules against INSTAGRAM_STORY.
//
// FIX (owner decision 2026-08-14): keep the per-placement IMAGE swap
// (square_1x1 -> feeds, story_9x16 -> stories/reels) but use a SINGLE body
// (the Facebook copy, no hashtags) across all placements. That collapses to
// TWO image-only rules — the same structure the earlier v2 creative passed
// validation with — so INSTAGRAM_STORY gets exactly one rule.
//
// Creates a corrected creative and repoints the EXISTING ad at it (ad id and
// PAUSED status preserved). Nothing goes live.
//
// Usage:
//   node "fix-hero-rule-count-v4.mjs"           # DRY RUN
//   node "fix-hero-rule-count-v4.mjs" --apply   # create creative + repoint ad

import { execFileSync } from 'node:child_process';

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
const VERSION = process.env.GRAPH_VERSION || 'v21.0';
const ACT = 'act_1349941660531643';
const BASE = `https://graph.facebook.com/${VERSION}`;

const PAGE_ID = '1009537752249937';
const IG_ID = '17841433199181682';
const AD_ID = '120248320654700243'; // CJW-Joburg-Hero-v3 (PAUSED)

// Reuse the already-uploaded image hashes from the v3 creative — same assets,
// no re-upload needed.
const HASH_SQUARE = '8e5b1d916bc8cc880effa85ee0dbc254';
const HASH_STORY = 'b5e911a6fab51fbd62cc5c28c9db9b18';

const LINK =
  'https://app.plugapro.co.za/?utm_source=meta&utm_medium=paid&utm_campaign=pap_client_acquisition_aug&utm_content=joburg_hero_v4';
const HEADLINE = 'Home help in your area — real quotes online';
const DESCRIPTION = 'Browse rated local providers, get a written quote and book on WhatsApp.';

// Single body = the approved Facebook copy (no hashtags), owner-chosen 2026-08-14.
const BODY =
  'Need help with a home job in Johannesburg?\n\n' +
  'Plug A Pro connects homeowners with independent local service providers for plumbing, painting, handyman work, cleaning, tiling, carpentry, plastering and more.\n\n' +
  'Tell us what you need, get matched with available providers, review the quote, and stay updated throughout the job.\n\n' +
  'Start your request on WhatsApp: +27 69 355 2447\nOr use the Plug A Pro PWA: app.plugapro.co.za\n\n' +
  'Local help. Real quotes. On WhatsApp or online.';

if (!TOKEN) {
  console.error('ERROR: no token (META_ADS_TOKEN env or keychain).');
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

const assetFeedSpec = {
  images: [
    { hash: HASH_SQUARE, adlabels: [{ name: 'square_1x1' }] },
    { hash: HASH_STORY, adlabels: [{ name: 'story_9x16' }] },
  ],
  bodies: [{ text: BODY }],
  titles: [{ text: HEADLINE }],
  descriptions: [{ text: DESCRIPTION }],
  link_urls: [{ website_url: LINK }],
  call_to_action_types: ['GET_QUOTE'],
  ad_formats: ['SINGLE_IMAGE'],
  // TWO image-only rules — exactly one per format. No body_label, so the
  // single body applies everywhere and no format gets a duplicate rule.
  asset_customization_rules: [
    {
      customization_spec: {
        publisher_platforms: ['facebook', 'instagram'],
        facebook_positions: ['feed', 'marketplace', 'search'],
        instagram_positions: ['stream', 'explore', 'profile_feed'],
      },
      image_label: { name: 'square_1x1' },
    },
    {
      customization_spec: {
        publisher_platforms: ['facebook', 'instagram'],
        facebook_positions: ['story', 'facebook_reels'],
        instagram_positions: ['story', 'reels'],
      },
      image_label: { name: 'story_9x16' },
    },
  ],
};

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const ad = await gget(AD_ID, { fields: 'id,name,status,effective_status,creative' });
  console.log(`Ad ${ad.id} — ${ad.name} (status=${ad.status}, effective=${ad.effective_status})`);
  console.log(`Current creative: ${ad.creative?.id}`);
  // Not-delivering statuses: the ad's own status is PAUSED, or a parent is
  // paused (ADSET_PAUSED / CAMPAIGN_PAUSED). Refuse only if it is genuinely
  // delivering (ACTIVE) — editing a live ad is out of scope here.
  const NOT_DELIVERING = new Set(['PAUSED', 'ADSET_PAUSED', 'CAMPAIGN_PAUSED']);
  if (ad.status === 'ACTIVE' && !NOT_DELIVERING.has(ad.effective_status)) {
    throw new Error(`Ad is delivering (status=${ad.status}, effective=${ad.effective_status}) — refusing to edit a live ad.`);
  }

  console.log('\nNew creative structure:');
  console.log('  images: square_1x1 (feeds), story_9x16 (stories/reels)');
  console.log('  body:   FB copy, no hashtags (single, all placements)');
  console.log('  rules:  2 image-only customization rules (1 per format)');
  console.log('  cta:    GET_QUOTE');

  if (!APPLY) {
    console.log('\nDRY RUN complete. Re-run with --apply.');
    return;
  }

  console.log('\nAPPLYING…');
  const creative = await gpost(`${ACT}/adcreatives`, {
    name: 'CJW-Joburg-Hero-v4 creative (single body, 2-rule image swap)',
    object_story_spec: { page_id: PAGE_ID, instagram_user_id: IG_ID },
    asset_feed_spec: assetFeedSpec,
  });
  console.log(`OK creative ${creative.id}`);

  await gpost(AD_ID, { creative: { creative_id: creative.id } });
  console.log(`OK ad ${AD_ID} repointed to creative ${creative.id}`);

  // Fresh previews for owner review.
  console.log('\nPreviews:');
  for (const fmt of ['MOBILE_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_STORY']) {
    try {
      const prev = await gget(`${creative.id}/previews`, { ad_format: fmt });
      const src = prev.data?.[0]?.body?.match(/src="([^"]+)"/)?.[1];
      console.log(`  ${fmt}: ${src ? src.replace(/&amp;/g, '&') : 'unavailable'}`);
    } catch (e) {
      console.log(`  ${fmt}: ${e.message}`);
    }
  }

  // Report the ad review status so the fix can be confirmed.
  const after = await gget(AD_ID, { fields: 'id,effective_status,review_feedback,creative{id}' });
  console.log(`\nAd effective_status: ${after.effective_status}`);
  console.log(`review_feedback: ${JSON.stringify(after.review_feedback || {})}`);
  console.log('\nDone. Ad still PAUSED. Re-check Review in Ads Manager (review can take a few minutes).');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
