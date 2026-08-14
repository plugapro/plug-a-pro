#!/usr/bin/env node
// G4 — narrow the spending provider-acquisition ad set's geo to the jhb_west
// matching-fence pin set.
//
// WHY: the live recruitment ad set targets "Johannesburg + 25km" (one city
// radius). That bleeds well outside the jhb_west matching fence
// (service-area-guard.ts: ACTIVE_REGIONS = ['jhb_west']) — into Soweto,
// Sandton, Midrand, east/south JHB — so ~80% of approved providers land where
// matching cannot serve them. Their technician_service_areas rows are created
// active=false by design (provider-record.ts), i.e. dormant inventory. This
// swaps the geo to the SAME four custom-location pins the August client
// campaign uses, so recruitment yield lands inside the fence that demand ads
// point at. Additive, reversible, and the ad set stays PAUSED throughout.
//
// It replaces ONLY geo_locations. Every other targeting dimension (age, the
// Home-improvement + Construction trade interests, brand-safety filters,
// audience automation with geo expansion already locked off) is read back and
// re-sent verbatim, because the Graph API replaces the whole `targeting`
// field on write.
//
// Usage:
//   node "narrow-provider-geo-to-jhb-west-pins.mjs"           # DRY RUN
//   node "narrow-provider-geo-to-jhb-west-pins.mjs" --apply   # perform edit (PAUSED)
//
// Token: META_ADS_TOKEN env var, falling back to the macOS keychain item.

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
const BASE = `https://graph.facebook.com/${VERSION}`;

// The spending provider ad set (campaign "PAP | Provider Acquisition | Greater
// JHB | Dry Run | 2026-07"). Confirmed by 90-day insights: R3,848 spend /
// 200k impressions / 5,758 clicks — the other provider campaign never spent.
const ADSET_ID = '120247565556140243';

// Same four pins as publish-august-client-acquisition.mjs — the union covers
// the active jhb_west suburb corridor and stays inside the matching fence
// (no Krugersdorp / Randfontein / Soweto bleed).
const PINS = [
  { name: 'Roodepoort core',       latitude: -26.1644, longitude: 27.873,  radius: 6 },
  { name: 'Constantia/Northcliff', latitude: -26.1455, longitude: 27.9262, radius: 5 },
  { name: 'Honeydew/Randpark',     latitude: -26.072,  longitude: 27.925,  radius: 6 },
  { name: 'Ruimsig/Featherbrooke', latitude: -26.096,  longitude: 27.854,  radius: 5 },
];

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

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const adset = await gget(ADSET_ID, {
    fields: 'id,name,effective_status,targeting',
  });

  if (adset.effective_status !== 'PAUSED') {
    throw new Error(
      `Ad set is ${adset.effective_status}, not PAUSED — refusing to edit a live ad set. Pause it first.`,
    );
  }

  const targeting = adset.targeting || {};
  const oldGeo = targeting.geo_locations || {};

  // Preserve location_types (home/recent) if present; default to the standard pair.
  const locationTypes = Array.isArray(oldGeo.location_types) ? oldGeo.location_types : ['home', 'recent'];

  const newTargeting = {
    ...targeting,
    geo_locations: {
      custom_locations: PINS.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        radius: p.radius,
        distance_unit: 'kilometer',
      })),
      location_types: locationTypes,
    },
  };

  console.log(`Ad set ${adset.id} (${adset.effective_status}) — ${adset.name}\n`);
  console.log('BEFORE geo_locations:');
  console.log('  ' + JSON.stringify(oldGeo));
  console.log('\nAFTER geo_locations:');
  console.log('  ' + JSON.stringify(newTargeting.geo_locations, null, 2).replace(/\n/g, '\n  '));
  console.log('\nPreserved untouched:');
  console.log('  age:', targeting.age_min, '-', targeting.age_max);
  const interests = (targeting.flexible_spec || []).flatMap((s) => (s.interests || []).map((i) => i.name));
  console.log('  interests:', interests.join(', ') || '(none)');
  console.log('  advantage_audience:', targeting.targeting_automation?.advantage_audience,
    '| geo expansion:', targeting.targeting_automation?.individual_setting?.geo);

  if (!APPLY) {
    console.log('\nDRY RUN complete. Re-run with --apply to write (ad set stays PAUSED).');
    return;
  }

  console.log('\nAPPLYING…');
  await gpost(ADSET_ID, { targeting: newTargeting });

  // Read back to confirm the write landed.
  const after = await gget(ADSET_ID, { fields: 'id,effective_status,targeting' });
  const landedGeo = after.targeting?.geo_locations || {};
  const pinCount = (landedGeo.custom_locations || []).length;
  const landedInterests = (after.targeting?.flexible_spec || [])
    .flatMap((s) => (s.interests || []).map((i) => i.name));
  console.log(`\nOK. Ad set now targets ${pinCount} custom-location pin(s); status ${after.effective_status}.`);
  console.log('Interests still present:', landedInterests.join(', ') || '(none)');
  if (pinCount !== PINS.length) {
    console.error(`WARNING: expected ${PINS.length} pins, read back ${pinCount}. Inspect in Ads Manager.`);
    process.exit(2);
  }
  console.log('\nDone. Ad set still PAUSED — flip it live in Ads Manager when ready.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
