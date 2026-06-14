#!/usr/bin/env node
// Replace West Rand campaign ad creatives with the corrected "Plug A Pro" images.
//
// What it does (and does NOT do):
//   - Finds the existing campaign + its ads (no new campaign / ad set / ad is created).
//   - For each ad, picks the corrected image by creative concept + placement aspect.
//   - Uploads the image as a NEW ad image, clones the ad's creative with the new
//     image_hash, and repoints the ad to the new creative.
//   - Preserves copy, link, CTA, url_tags/UTM, targeting (on ad set), budget, and the
//     ad's PAUSED/ACTIVE status. Meta ad creatives are immutable, so "replace image"
//     necessarily means new image -> new creative -> repoint ad. This is the only
//     supported way and changes nothing else.
//
// Usage:
//   META_ADS_TOKEN=<system-user token with ads_management> \
//   node "replace-creatives.mjs"            # DRY RUN — prints the plan, mutates nothing
//   ... node "replace-creatives.mjs" --apply   # actually performs the swap
//
// Optional env:
//   AD_ACCOUNT_ID   default act_1349941660531643
//   CAMPAIGN_ID     skip name search and target this campaign id directly
//   CAMPAIGN_MATCH  substring to match campaign name (default "West Rand")
//   GRAPH_VERSION   default v21.0
//
// Nothing is mutated unless you pass --apply. Review the dry-run table first.

import { readFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const TOKEN = process.env.META_ADS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
const ACT = (process.env.AD_ACCOUNT_ID || 'act_1349941660531643').replace(/^act_?/, 'act_');
const VERSION = process.env.GRAPH_VERSION || 'v21.0';
const CAMPAIGN_ID = process.env.CAMPAIGN_ID || '';
const CAMPAIGN_MATCH = (process.env.CAMPAIGN_MATCH || 'West Rand').toLowerCase();
const BASE = `https://graph.facebook.com/${VERSION}`;

if (!TOKEN) {
  console.error('ERROR: set META_ADS_TOKEN to a token with ads_management on the ad account.');
  process.exit(1);
}

const DIR_1x1 = join(HERE, 'plug_a_pro_campaign_fixed_1x1');
const DIR_3x4 = join(HERE, 'plug_a_pro_campaign_fixed_3x4');

// concept -> { square (1:1 feed), portrait (3:4) } corrected files.
const CONCEPT_MAP = {
  now_live:     { square: 'PAP-Client Acquisition-Now Live West Rand Roodepoort.png', portrait: 'PAP-Client Acquisition-Now Live West Rand Roodepoort.png' },
  ready_today:  { square: 'PAP-Client Acquisition-Local Independent Ready Today.png', portrait: 'PAP-Client Acquisition-Local Independent Ready Today.png' },
  handyman:     { square: 'PAP-Client Acquisition-Handyman Done Right West Rand.png', portrait: 'PAP-Client Acquisition-Handyman Done Right West Rand.png' },
  painters:     { square: 'PAP-Client Acquisition-Painters In Your Area West Rand.png', portrait: 'PAP-Client Acquisition-Painters In Your Area West Rand.png' },
  home_better:  { square: 'PAP-Client Acquisition-Your Home Deserves Better.png', portrait: 'PAP-Client Acquisition-Your Home Deserves Better.png' },
  book_online:  { square: 'PAP-Client Acquisition-Book Home Services Online.png', portrait: 'PAP-Client Acquisition-Book Home Services Online.png' },
  cleaners:     { square: 'PAP-Client Acquisition-Local Cleaners.png', portrait: 'PAP-Client Acquisition-Local Cleaners.png' },
};

// keyword -> concept, tested against (creative name + current image name/url), lowercased.
const RULES = [
  [/now live|roodepoort|\bmap\b|now-live/, 'now_live'],
  [/ready today|local independent|independent ready|\bgate\b/, 'ready_today'],
  [/handyman/, 'handyman'],
  [/painter|paint\b/, 'painters'],
  [/deserves better|home deserves|transform|before|after/, 'home_better'],
  [/book home|book online|services online|book any service/, 'book_online'],
  [/clean/, 'cleaners'],
];

function conceptFor(text) {
  const t = (text || '').toLowerCase();
  for (const [re, concept] of RULES) if (re.test(t)) return concept;
  return null;
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

async function uploadImage(absPath) {
  const buf = readFileSync(absPath);
  const name = basename(absPath);
  const form = new FormData();
  form.set('access_token', TOKEN);
  form.set('filename', new Blob([buf], { type: 'image/png' }), name);
  const r = await fetch(`${BASE}/${ACT}/adimages`, { method: 'POST', body: form });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`upload ${name}: ${JSON.stringify(j.error || j)}`);
  const first = Object.values(j.images || {})[0];
  if (!first?.hash) throw new Error(`upload ${name}: no hash in ${JSON.stringify(j)}`);
  return first.hash;
}

const imageCache = new Map(); // absPath -> hash
async function hashFor(absPath) {
  if (imageCache.has(absPath)) return imageCache.get(absPath);
  const h = await uploadImage(absPath);
  imageCache.set(absPath, h);
  return h;
}

async function dimsForHashes(hashes) {
  const out = {};
  const uniq = [...new Set(hashes.filter(Boolean))];
  if (!uniq.length) return out;
  const j = await gget(`${ACT}/adimages`, { hashes: JSON.stringify(uniq), fields: 'hash,width,height' });
  for (const img of j.data || []) out[img.hash] = { w: img.width, h: img.height };
  return out;
}

function pickFile(concept, portrait) {
  const m = CONCEPT_MAP[concept];
  if (!m) return null;
  const folder = portrait ? DIR_3x4 : DIR_1x1;
  return join(folder, portrait ? m.portrait : m.square);
}

async function resolveCampaignId() {
  if (CAMPAIGN_ID) return CAMPAIGN_ID;
  const j = await gget(`${ACT}/campaigns`, { fields: 'id,name,effective_status', limit: '200' });
  const hit = (j.data || []).find((c) => c.name?.toLowerCase().includes(CAMPAIGN_MATCH));
  if (!hit) throw new Error(`No campaign matching "${CAMPAIGN_MATCH}". Set CAMPAIGN_ID explicitly.`);
  console.log(`Campaign: ${hit.name} (${hit.id})  status=${hit.effective_status}`);
  return hit.id;
}

// Build a new object_story_spec with image hashes swapped. Returns {spec, plan[]} or null.
function planSpec(spec, hashByConcept, dims, label) {
  if (!spec) return null;
  const clone = JSON.parse(JSON.stringify(spec));
  const plan = [];
  const link = clone.link_data;
  const photo = clone.photo_data;

  const isPortrait = (hash) => {
    const d = hash && dims[hash];
    return d ? d.h > d.w : false;
  };

  if (link?.child_attachments?.length) {
    for (const [i, card] of link.child_attachments.entries()) {
      const c = conceptFor(`${card.name || ''} ${card.description || ''} ${card.link || ''} ${card.image_hash || ''}`);
      const portrait = isPortrait(card.image_hash); // carousel cards are square in feed
      const file = c && pickFile(c, portrait);
      plan.push({ part: `card ${i}`, concept: c, portrait, file });
      if (file) card._file = file; // marker resolved in apply step
    }
  } else if (link && (link.image_hash !== undefined || link.picture)) {
    const c = label;
    const portrait = isPortrait(link.image_hash);
    const file = c && pickFile(c, portrait);
    plan.push({ part: 'image', concept: c, portrait, file });
    if (file) link._file = file;
  } else if (photo && (photo.image_hash !== undefined)) {
    const c = label;
    const portrait = isPortrait(photo.image_hash);
    const file = c && pickFile(c, portrait);
    plan.push({ part: 'photo', concept: c, portrait, file });
    if (file) photo._file = file;
  } else {
    return { spec: null, plan: [{ part: 'UNHANDLED', concept: null, portrait: false, file: null }] };
  }
  return { spec: clone, plan };
}

async function finalizeSpec(clone) {
  // Replace _file markers with freshly uploaded image hashes (only in --apply).
  const link = clone.link_data;
  const photo = clone.photo_data;
  if (link?.child_attachments?.length) {
    for (const card of link.child_attachments) {
      if (card._file) { card.image_hash = await hashFor(card._file); delete card._file; delete card.picture; }
    }
  }
  if (link?._file) { link.image_hash = await hashFor(link._file); delete link._file; delete link.picture; }
  if (photo?._file) { photo.image_hash = await hashFor(photo._file); delete photo._file; delete photo.url; }
  return clone;
}

async function main() {
  console.log(`Ad account: ${ACT}   mode: ${APPLY ? 'APPLY (will mutate)' : 'DRY RUN'}\n`);
  const campaignId = await resolveCampaignId();

  const adsResp = await gget(`${campaignId}/ads`, {
    fields: 'id,name,status,effective_status,adset{id,name},creative{id,name,object_story_spec,asset_feed_spec,image_hash}',
    limit: '200',
  });
  const ads = adsResp.data || [];
  console.log(`Found ${ads.length} ads.\n`);

  // gather all current image hashes to fetch dimensions (square vs portrait).
  const allHashes = [];
  for (const ad of ads) {
    const s = ad.creative?.object_story_spec;
    if (s?.link_data?.image_hash) allHashes.push(s.link_data.image_hash);
    if (s?.photo_data?.image_hash) allHashes.push(s.photo_data.image_hash);
    for (const c of s?.link_data?.child_attachments || []) if (c.image_hash) allHashes.push(c.image_hash);
  }
  const dims = await dimsForHashes(allHashes);

  const planned = [];
  for (const ad of ads) {
    const cr = ad.creative || {};
    const label = conceptFor(`${ad.name || ''} ${cr.name || ''}`);
    if (cr.asset_feed_spec) {
      planned.push({ ad, label, unhandled: 'asset_feed_spec (Advantage+ flexible) — handle manually', parts: [] });
      continue;
    }
    const res = planSpec(cr.object_story_spec, null, dims, label);
    if (!res || !res.spec) {
      planned.push({ ad, label, unhandled: res?.plan?.[0]?.part === 'UNHANDLED' ? 'no link/photo image in creative' : 'no object_story_spec', parts: res?.plan || [] });
      continue;
    }
    planned.push({ ad, label, spec: res.spec, parts: res.plan });
  }

  // print plan table
  console.log('PLAN');
  console.log('─'.repeat(96));
  for (const p of planned) {
    const a = p.ad;
    console.log(`Ad: ${a.name}  [${a.id}]  status=${a.status}/${a.effective_status}  adset=${a.adset?.name || ''}`);
    if (p.unhandled) { console.log(`   !! SKIP: ${p.unhandled}`); console.log(''); continue; }
    for (const part of p.parts) {
      const ratio = part.portrait ? '3:4' : '1:1';
      console.log(`   ${part.part}: concept=${part.concept || 'UNMATCHED'}  ratio=${ratio}  -> ${part.file ? basename(part.file) : 'NO MATCH (skipped)'}`);
    }
    console.log('');
  }
  console.log('─'.repeat(96));

  if (!APPLY) {
    console.log('\nDRY RUN complete. Nothing was changed. Re-run with --apply to perform the swap.');
    return;
  }

  console.log('\nAPPLYING…\n');
  for (const p of planned) {
    if (p.unhandled || !p.spec) { console.log(`SKIP ${p.ad.name}: ${p.unhandled || 'no spec'}`); continue; }
    const hasUnmatched = p.parts.some((x) => !x.file);
    if (hasUnmatched) { console.log(`SKIP ${p.ad.name}: one or more parts unmatched (fix CONCEPT_MAP/RULES first)`); continue; }
    try {
      const spec = await finalizeSpec(JSON.parse(JSON.stringify(p.spec)));
      const creative = await gpost(`${ACT}/adcreatives`, {
        name: `${p.ad.creative?.name || p.ad.name} — Plug A Pro fixed`,
        object_story_spec: spec,
      });
      await gpost(`${p.ad.id}`, { creative: { creative_id: creative.id } });
      console.log(`OK  ${p.ad.name}  -> new creative ${creative.id} (ad stays ${p.ad.status})`);
    } catch (e) {
      console.log(`FAIL ${p.ad.name}: ${e.message}`);
    }
  }
  console.log('\nDone. Ads were repointed to new creatives; status/copy/targeting/budget unchanged.');
}

main().catch((e) => { console.error(e); process.exit(1); });
