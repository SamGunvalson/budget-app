/**
 * App color palette for data (chart series, category colors).
 *
 * Derived from the Cashflow chart's muted mid-tones. The same hexes are the
 * 300/400/500/700 steps of the re-tinted Tailwind scales in src/index.css, so
 * a category colored "Rose" matches `pink-*` UI accents exactly.
 *
 * If you change a hex here, regenerate the matching scale in index.css.
 */

/** Ordered series colors for multi-line / multi-bar charts. */
export const SERIES_COLORS = [
  '#4f86c6', // blue
  '#8b6fc0', // violet
  '#2a9d9a', // teal
  '#c0607a', // rose
  '#7a8f3a', // olive
  '#5c6bc0', // indigo
  '#a0715a', // clay
  '#9a6b9e', // plum
];

/**
 * Category color families. Each family has four shades (pale → deep) so
 * related categories can share a hue and still be told apart.
 * `tw` is the Tailwind scale the family maps to in index.css.
 */
export const COLOR_FAMILIES = [
  { id: 'rose', label: 'Rose', tw: 'pink', shades: ['#f5aabb', '#df839a', '#c0607a', '#8b3d53'] },
  { id: 'coral', label: 'Coral', tw: 'rose', shades: ['#f4aeac', '#dd8886', '#c46a6a', '#8a4242'] },
  { id: 'clay', label: 'Clay', tw: 'yellow', shades: ['#dfb9a8', '#c59781', '#a0715a', '#77503e'] },
  { id: 'gold', label: 'Gold', tw: 'amber', shades: ['#f7d688', '#f4c662', '#eeb444', '#8f5f16'] },
  { id: 'olive', label: 'Olive', tw: 'lime', shades: ['#bacb90', '#99ad61', '#7a8f3a', '#52631b'] },
  { id: 'sage', label: 'Sage', tw: 'green', shades: ['#a9d09c', '#82b372', '#5c8f4a', '#3e672f'] },
  { id: 'jade', label: 'Jade', tw: 'emerald', shades: ['#95d3b1', '#65b78d', '#3d9a6e', '#1a6b48'] },
  { id: 'teal', label: 'Teal', tw: 'teal', shades: ['#8bd2ce', '#55b5b2', '#2a9d9a', '#016967'] },
  { id: 'sky', label: 'Sky', tw: 'sky', shades: ['#98cbe7', '#6baccf', '#4a93b8', '#246280'] },
  { id: 'blue', label: 'Blue', tw: 'blue', shades: ['#9dc6f7', '#73a6e3', '#4f86c6', '#2f5d90'] },
  { id: 'indigo', label: 'Indigo', tw: 'indigo', shades: ['#b0bffe', '#8b9def', '#5c6bc0', '#48549a'] },
  { id: 'violet', label: 'Violet', tw: 'violet', shades: ['#cab6f5', '#ac93e0', '#8b6fc0', '#634c8e'] },
  { id: 'plum', label: 'Plum', tw: 'purple', shades: ['#d9b4db', '#be91c2', '#9a6b9e', '#714b74'] },
  { id: 'orchid', label: 'Orchid', tw: 'fuchsia', shades: ['#e5afd4', '#cc8bb9', '#a86495', '#7c456d'] },
  { id: 'stone', label: 'Stone', tw: 'stone', shades: ['#c3cabd', '#949f95', '#647167', '#4f5e54'] },
];

export const SHADE_LABELS = ['Pale', 'Light', 'Mid', 'Deep'];

const byId = Object.fromEntries(COLOR_FAMILIES.map((f) => [f.id, f]));
const mid = (id) => byId[id].shades[2];

/** Default color for each category type (matches the type dots). */
export const TYPE_COLORS = {
  income: mid('jade'),
  needs: mid('coral'),
  wants: mid('rose'),
  savings: mid('teal'),
  transfer: mid('stone'),
};

export const DEFAULT_CATEGORY_COLOR = TYPE_COLORS.income;

// Old preset swatches (Tailwind defaults) → their new-family equivalents.
const LEGACY_MAP = {
  '#ef4444': mid('coral'),
  '#ec4899': mid('rose'),
  '#f59e0b': mid('gold'),
  '#10b981': mid('jade'),
  '#14b8a6': mid('teal'),
  '#06b6d4': mid('sky'),
  '#6366f1': mid('indigo'),
  '#8b5cf6': mid('violet'),
  '#3b82f6': mid('blue'),
  '#84cc16': mid('olive'),
  '#64748b': mid('stone'),
  '#94a3b8': COLOR_FAMILIES.at(-1).shades[1],
};

const PALETTE_INDEX = new Map(
  COLOR_FAMILIES.flatMap((f) => f.shades.map((hex, shade) => [hex, { family: f, shade }])),
);

export function normalizeHex(hex) {
  if (typeof hex !== 'string') return null;
  const h = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(h)) return h;
  if (/^#[0-9a-f]{3}$/.test(h)) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return null;
}

/** `{ family, shade }` when `hex` is a palette swatch, else null. */
export function findPaletteColor(hex) {
  return PALETTE_INDEX.get(normalizeHex(hex)) ?? null;
}

/** "Rose · Mid" for palette swatches, the hex otherwise. */
export function describeColor(hex) {
  const match = findPaletteColor(hex);
  return match ? `${match.family.label} · ${SHADE_LABELS[match.shade]}` : normalizeHex(hex) ?? hex;
}

// ── Nearest-swatch matching (OKLab distance) ────────────────────────────────
function toOklab(hex) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const toLch = (hex) => {
  const [L, A, B] = toOklab(hex);
  return { L, C: Math.hypot(A, B), H: (Math.atan2(B, A) * 180) / Math.PI };
};
const hueGap = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const FAMILY_LCH = COLOR_FAMILIES.map((f) => ({ family: f, mid: toLch(f.shades[2]), shades: f.shades.map(toLch) }));
const NEUTRAL_CHROMA = 0.035;

/**
 * The palette swatch closest to `hex`. Old preset colors map to their
 * family's mid shade; anything else keeps its hue family (grays go to Stone)
 * and takes the shade nearest in lightness.
 * Returns the input unchanged if it is already a swatch or not a valid hex.
 */
export function nearestPaletteColor(hex) {
  const h = normalizeHex(hex);
  if (!h) return hex;
  if (PALETTE_INDEX.has(h)) return h;
  if (LEGACY_MAP[h]) return LEGACY_MAP[h];
  const { L, C, H } = toLch(h);
  const candidates = FAMILY_LCH.filter(({ family }) => (C < NEUTRAL_CHROMA) === (family.id === 'stone'));
  let fam = candidates[0];
  for (const f of candidates) if (hueGap(H, f.mid.H) < hueGap(H, fam.mid.H)) fam = f;
  let shade = 0;
  fam.shades.forEach((s, i) => { if (Math.abs(s.L - L) < Math.abs(fam.shades[shade].L - L)) shade = i; });
  return fam.family.shades[shade];
}
