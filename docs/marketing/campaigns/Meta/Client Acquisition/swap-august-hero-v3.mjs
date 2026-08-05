#!/usr/bin/env node
// Swap the August client campaign onto v3: owner-supplied per-platform copy — PAUSED.
//
// Replaces ad "CJW-Joburg-Hero-v1" (single 1:1 image) with
// "CJW-Joburg-Hero-v2": one ad whose creative uses asset_feed_spec
// placement customization —
//   1:1  (1254x1254) -> Facebook feed + Instagram feed/explore
//   9:16 (941x1672)  -> Facebook/Instagram Stories + Reels
// The v1 ad is deleted afterwards (it is PAUSED and has never served, so
// this is a clean draft replacement, not history rewriting).
//
// Usage:
//   node swap-august-hero-v2.mjs            # DRY RUN
//   node swap-august-hero-v2.mjs --apply    # perform the swap (PAUSED)

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
const ACT = 'act_1349941660531643';
const VERSION = process.env.GRAPH_VERSION || 'v21.0';
const PAGE_ID = '1009537752249937';
const IG_ID = '17841433199181682';
const BASE = `https://graph.facebook.com/${VERSION}`;

const CAMPAIGN_NAME = 'PAP | JHB West | Client Acquisition | Aug 2026';
const ADSET_NAME = 'CJW-Pins-Broad';
const OLD_AD_NAME = 'CJW-Joburg-Hero-v2';
const NEW_AD_NAME = 'CJW-Joburg-Hero-v3';

const IMG_SQUARE = join(HERE, 'plug_a_pro_campaign_fixed_1x1', 'PAP-Client Acquisition-Joburg Hero v2 1x1.png');
const IMG_STORY = join(HERE, 'plug_a_pro_campaign_9x16', 'PAP-Client Acquisition-Joburg Hero v2 9x16.png');

const LINK =
  'https://app.plugapro.co.za/?utm_source=meta&utm_medium=paid&utm_campaign=pap_client_acquisition_aug&utm_content=joburg_hero_v3';

const HEADLINE = 'Home help in your area — real quotes online';
// Owner-supplied copy, 2026-08-05. FB and IG get different bodies via
// asset_feed_spec body labels — same mechanism as the image split.
const BODY_FB =
  'Need help with a home job in Johannesburg?\n\nPlug A Pro connects homeowners with independent local service providers for plumbing, painting, handyman work, cleaning, tiling, carpentry, plastering and more.\n\nTell us what you need, get matched with available providers, review the quote, and stay updated throughout the job.\n\nStart your request on WhatsApp: +27 69 355 2447\nOr use the Plug A Pro PWA: app.plugapro.co.za\n\nLocal help. Real quotes. On WhatsApp or online.';
const BODY_IG =
  'Got a home job that needs attention?\n\nFrom plumbing and painting to handyman work, cleaning and more, Plug A Pro helps connect you with independent local service providers across Johannesburg.\n\nTell us the job. Get matched. Review the quote. Stay updated.\n\nWhatsApp: +27 69 355 2447\nOnline: app.plugapro.co.za\n\n#PlugAPro #JohannesburgServices #HomeRepairs #PlumberJohannesburg #HandymanJohannesburg #CleaningServices #PaintingServices #LocalServiceProviders #JoburgHomes';

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

async function gdelete(path) {
  const u = new URL(`${BASE}/${path}`);
  u.searchParams.set('access_token', TOKEN);
  const r = await fetch(u, { method: 'DELETE' });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`DELETE ${path}: ${JSON.stringify(j.error || j)}`);
  return j;
}

async function uploadImage(absPath) {
  const buf = readFileSync(absPath);
  const form = new FormData();
  form.set('access_token', TOKEN);
  form.set('filename', new Blob([buf], { type: 'image/png' }), basename(absPath));
  const r = await fetch(`${BASE}/${ACT}/adimages`, { method: 'POST', body: form });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`upload ${basename(absPath)}: ${JSON.stringify(j.error || j)}`);
  const first = Object.values(j.images || {})[0];
  if (!first?.hash) throw new Error(`upload: no hash`);
  return first.hash;
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const campaigns = await gget(`${ACT}/campaigns`, { fields: 'id,name,effective_status', limit: '200' });
  const campaign = (campaigns.data || []).find(
    (c) => c.name === CAMPAIGN_NAME && c.effective_status !== 'DELETED'
  );
  if (!campaign) throw new Error(`Campaign not found: ${CAMPAIGN_NAME}`);
  if (campaign.effective_status !== 'PAUSED') {
    throw new Error(`Campaign is ${campaign.effective_status}, not PAUSED — refusing to swap creatives on a live campaign.`);
  }

  const adsets = await gget(`${campaign.id}/adsets`, { fields: 'id,name', limit: '50' });
  const adset = (adsets.data || []).find((s) => s.name === ADSET_NAME);
  if (!adset) throw new Error(`Ad set not found: ${ADSET_NAME}`);

  const ads = await gget(`${adset.id}/ads`, { fields: 'id,name,effective_status', limit: '50' });
  const oldAd = (ads.data || []).find((a) => a.name === OLD_AD_NAME);
  const dupe = (ads.data || []).find((a) => a.name === NEW_AD_NAME);

  console.log(`Campaign ${campaign.id} (PAUSED) / ad set ${adset.id}`);
  console.log(`v1 ad: ${oldAd ? `${oldAd.id} (${oldAd.effective_status}) — will be DELETED after v2 exists` : 'not present'}`);
  console.log(`v2 ad: ${dupe ? `${dupe.id} already exists — will skip create` : 'to create (PAUSED)'}`);
  console.log(`square: ${basename(IMG_SQUARE)} -> FB feed + IG feed/explore`);
  console.log(`story:  ${basename(IMG_STORY)} -> FB/IG Stories + Reels`);
  console.log(`link:   ${LINK}`);

  if (!APPLY) {
    console.log('\nDRY RUN complete. Re-run with --apply.');
    return;
  }

  console.log('\nAPPLYING…\n');

  let newAdId = dupe?.id;
  if (!dupe) {
    const [hashSquare, hashStory] = [await uploadImage(IMG_SQUARE), await uploadImage(IMG_STORY)];

    const creative = await gpost(`${ACT}/adcreatives`, {
      name: `${NEW_AD_NAME} creative`,
      object_story_spec: {
        page_id: PAGE_ID,
        instagram_user_id: IG_ID,
      },
      asset_feed_spec: {
        images: [
          { hash: hashSquare, adlabels: [{ name: 'square_1x1' }] },
          { hash: hashStory, adlabels: [{ name: 'story_9x16' }] },
        ],
        bodies: [
          { text: BODY_FB, adlabels: [{ name: 'body_fb' }] },
          { text: BODY_IG, adlabels: [{ name: 'body_ig' }] },
        ],
        titles: [{ text: HEADLINE }],
        link_urls: [{ website_url: LINK }],
        // BOOK_NOW is rejected for dynamic-creative (asset_feed_spec) ads on
        // the LINK_CLICKS objective (subcode 1885396). GET_QUOTE matches the
        // creative's "Real quotes" promise and is the closest supported CTA.
        call_to_action_types: ['GET_QUOTE'],
        ad_formats: ['SINGLE_IMAGE'],
        asset_customization_rules: [
          {
            customization_spec: {
              publisher_platforms: ['facebook'],
              facebook_positions: ['feed', 'marketplace', 'search'],
            },
            image_label: { name: 'square_1x1' },
            body_label: { name: 'body_fb' },
          },
          {
            customization_spec: {
              publisher_platforms: ['instagram'],
              instagram_positions: ['stream', 'explore', 'profile_feed'],
            },
            image_label: { name: 'square_1x1' },
            body_label: { name: 'body_ig' },
          },
          {
            customization_spec: {
              publisher_platforms: ['facebook'],
              facebook_positions: ['story', 'facebook_reels'],
            },
            image_label: { name: 'story_9x16' },
            body_label: { name: 'body_fb' },
          },
          {
            customization_spec: {
              publisher_platforms: ['instagram'],
              instagram_positions: ['story', 'reels'],
            },
            image_label: { name: 'story_9x16' },
            body_label: { name: 'body_ig' },
          },
        ],
      },
    });
    console.log(`OK creative ${creative.id}`);

    const adObj = await gpost(`${ACT}/ads`, {
      name: NEW_AD_NAME,
      adset_id: adset.id,
      status: 'PAUSED',
      creative: { creative_id: creative.id },
    });
    newAdId = adObj.id;
    console.log(`OK ad ${NEW_AD_NAME} ${adObj.id}`);

    for (const fmt of ['MOBILE_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_STORY']) {
      try {
        const prev = await gget(`${creative.id}/previews`, { ad_format: fmt });
        const src = prev.data?.[0]?.body?.match(/src="([^"]+)"/)?.[1];
        if (src) console.log(`   ${fmt}: ${src.replace(/&amp;/g, '&')}`);
      } catch {
        console.log(`   ${fmt}: preview unavailable`);
      }
    }
  }

  if (oldAd && newAdId) {
    await gdelete(oldAd.id);
    console.log(`DELETED v1 ad ${oldAd.id} (never served)`);
  }

  console.log('\nDone. Campaign still PAUSED. Review previews + Advantage+ toggles, then flip to launch.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
