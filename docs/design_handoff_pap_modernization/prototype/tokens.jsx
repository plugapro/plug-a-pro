// tokens.jsx — Design tokens for Plug A Pro
// Soft neutrals + gradient accent. Light/dark, density, radius, palette.

const BRAND_PALETTES = {
  // Default = logo gradient (pink → purple → blue)
  vibrant: { pink: '#FF1F8E', purple: '#8B3FE8', blue: '#2A78F0', start: '#FF1F8E', mid: '#8B3FE8', end: '#2A78F0' },
  // Calmer — more purple-lead, less pink
  calm:    { pink: '#C84DBE', purple: '#7B5BE0', blue: '#3F86E8', start: '#C84DBE', mid: '#7B5BE0', end: '#3F86E8' },
  // Sunset — keep brand pink, swap blue for warm
  sunset:  { pink: '#FF3D7F', purple: '#B14CE0', blue: '#FF8A3D', start: '#FF8A3D', mid: '#FF3D7F', end: '#B14CE0' },
  // Mono — gradient collapses to single ink (for testing how restrained looks)
  mono:    { pink: '#3D3D45', purple: '#1F1F26', blue: '#0A0A0F', start: '#3D3D45', mid: '#1F1F26', end: '#0A0A0F' },
};

const WHATSAPP = '#25D366';
const WHATSAPP_DARK = '#1FAD52';
const SUCCESS = '#0F9D58';
const WARN = '#E69900';
const DANGER = '#E5484D';

// Density scales — spacing multiplier
const DENSITY = {
  compact: { pad: 12, gap: 8,  rowH: 44, cardPad: 16, sectionGap: 16, scale: 0.94 },
  cozy:    { pad: 16, gap: 12, rowH: 52, cardPad: 20, sectionGap: 24, scale: 1 },
  comfy:   { pad: 20, gap: 16, rowH: 60, cardPad: 24, sectionGap: 32, scale: 1.06 },
};

function buildTheme(t) {
  const pal = BRAND_PALETTES[t.palette] || BRAND_PALETTES.vibrant;
  const d = DENSITY[t.density] || DENSITY.cozy;
  const dark = t.dark;
  const r = t.radius; // base radius scale, default 16

  return {
    pal,
    dark,
    whatsapp: WHATSAPP,
    whatsappDark: WHATSAPP_DARK,
    success: SUCCESS,
    warn: WARN,
    danger: DANGER,
    // surfaces
    page:    dark ? '#0B0B10' : '#F6F6F8',
    card:    dark ? '#15161C' : '#FFFFFF',
    cardAlt: dark ? '#1B1C24' : '#F1F1F4',
    border:  dark ? '#26272F' : '#EBEBEF',
    borderStrong: dark ? '#33343D' : '#D9D9DE',
    // text
    ink:     dark ? '#F4F4F6' : '#0A0A0F',
    inkMute: dark ? '#A0A0AB' : '#6B6F76',
    inkSoft: dark ? '#71727B' : '#9CA0A8',
    // gradient strings
    grad:    `linear-gradient(135deg, ${pal.start} 0%, ${pal.mid} 50%, ${pal.end} 100%)`,
    gradSoft:`linear-gradient(135deg, ${pal.start}18 0%, ${pal.mid}14 50%, ${pal.end}18 100%)`,
    // radii
    r: {
      xs: Math.max(4, r * 0.375),
      sm: Math.max(8, r * 0.625),
      md: r,
      lg: r * 1.5,
      xl: r * 1.75,
      pill: 999,
    },
    // density
    d,
    // font
    fam: '"Plus Jakarta Sans", -apple-system, system-ui, sans-serif',
    mono: '"DM Mono", ui-monospace, "SF Mono", Menlo, monospace',
    // helpers
    showWA: t.showWhatsApp !== false,
  };
}

window.buildTheme = buildTheme;
window.BRAND_PALETTES = BRAND_PALETTES;
