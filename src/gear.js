// Earned gear that never runs out (decisions.md, 2026-10-21: placement wins a board or outfit that is "more basic with
// patterns but still stuff people want", different from purchased items; clear genders). Ed, 2026-10-21: men wear no shirts and
// no suits; outfits are matching sets.
//
// A piece is a recipe: slot x body x pattern x two colours x tier. Recipes are saved as recipes (not ids) so a piece
// survives a reload even if the palette table changes, and become catalog-shaped items the surfer can wear. Every outfit is one
// piece, one pattern, one colour pair:
//   board   neutral (no body), the shortboard shape only
//   bottom  board shorts for the male body; the bikini (top and bottom, one pattern) for the female body
//   set     female only: a rashguard with its matching bottom
//   suit    female only: fullsuit (rare and epic only)
// A male win may come as a kit (tour.json gear.kit): the shorts and a board in the same pattern and colours, granted together.
// Earned pieces never carry a premium-only trait: no other board shape, no image print, no metallic finish.
import tourData from "./data/tour.json" with { type: "json" };
import catalogData from "./data/catalog.json" with { type: "json" };

const G = tourData.gear;
export const GEAR_TIERS = ["common", "rare", "epic"];
const BODIES = ["male", "female"];
const SLOTS = ["board", "bottom", "set", "suit"];
// slots each body can wear: men have board shorts and a board only
const BODY_SLOTS = { male: ["board", "bottom"], female: ["board", "bottom", "set", "suit"] };
const PATTERNS = Object.keys(G.patternNames);
const HEX = /^#[0-9a-f]{6}$/;

export function recipeId(r) {
  return `gen:${r.slot}:${r.body || "any"}:${r.pattern}:${r.color.slice(1)}:${r.color2.slice(1)}`;
}

function sentence(r) {
  const pat = G.patternNames[r.pattern];
  if (r.slot === "board") return `${r.name} ${pat} Shortboard`;
  if (r.slot === "bottom") return `${r.name} ${pat} ${r.body === "male" ? "Board Shorts" : "Bikini"}`;
  if (r.slot === "set") return `Women's ${r.name} ${pat} Rashguard Set`;
  return `Women's ${r.name} ${pat} Fullsuit`;
}

/**
 * Bring a recipe saved by an earlier build up to the current rules, or return null if the piece no longer exists. A men's
 * rashguard or fullsuit is dropped (men wear neither); a women's rashguard becomes the matching set, same pattern and colours.
 */
export function migrateRecipe(r) {
  if (!r || typeof r !== "object") return r;
  if (r.slot === "top") return r.body === "female" ? { ...r, slot: "set" } : null;
  if (r.slot === "suit" && r.body === "male") return null;
  return r;
}

/** Check a recipe and return the catalog-shaped item it stands for. Throws, naming the field, if it is not a valid earned piece. */
export function recipeToItem(r) {
  if (!r || typeof r !== "object") throw new Error("gear recipe is not an object");
  if (!SLOTS.includes(r.slot)) throw new Error(`gear recipe slot "${r.slot}" is not one of ${SLOTS.join(", ")}`);
  if (!GEAR_TIERS.includes(r.tier)) throw new Error(`gear recipe tier "${r.tier}" is not one of ${GEAR_TIERS.join(", ")}`);
  if (!PATTERNS.includes(r.pattern)) throw new Error(`gear recipe pattern "${r.pattern}" is not a basic earned pattern (${PATTERNS.join(", ")})`);
  for (const key of ["color", "color2"]) {
    if (typeof r[key] !== "string" || !HEX.test(r[key])) throw new Error(`gear recipe ${key} "${r[key]}" is not a lowercase #rrggbb colour`);
  }
  if (typeof r.name !== "string" || !r.name) throw new Error("gear recipe has no palette name");
  if (r.slot === "board") {
    if (r.body !== null && r.body !== undefined) throw new Error("a board is neutral: its recipe body must be null");
  } else if (!BODIES.includes(r.body)) {
    throw new Error(`gear recipe body "${r.body}" must be male or female for slot ${r.slot}`);
  } else if (!BODY_SLOTS[r.body].includes(r.slot)) {
    throw new Error(`gear recipe slot "${r.slot}" is not worn by the ${r.body} body (men wear board shorts and a board only)`);
  }
  if (r.slot === "suit" && r.tier === "common") throw new Error("a fullsuit is rare or epic, not common");
  const base = { id: recipeId({ ...r, body: r.body || null }), name: sentence(r), tier: "earned", price: 0, ownedDefault: false, reward: r.tier, color: r.color, color2: r.color2, pattern: r.pattern, generated: true };
  if (r.slot === "board") return { ...base, shape: "short" };
  if (r.slot === "bottom") return { ...base, body: r.body, slot: r.body === "male" ? "bottom" : "outfit", style: r.body === "male" ? "trunks" : "bikini" };
  if (r.slot === "set") return { ...base, body: r.body, slot: "outfit", style: "rashset" };
  return { ...base, body: r.body, slot: "outfit", style: "fullsuit" };
}

function hslHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

// A garment must never read as bare skin (Ed, 2026-10-21: the gold set on the light tone looked topless). The main colour of
// every piece stays at least SKIN_CLEARANCE away from every catalog skin tone, as CIE76 delta E in CIELAB (D65), a distance
// the eye reads as clearly different colours (2 is just noticeable, 20 is well apart). scripts/check-genders.mjs enforces it.
export const SKIN_CLEARANCE = 20;
const SKIN_HEXES = catalogData.skinTones.map((t) => t.color);

function lab(hex) {
  const lin = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin(1), lin(3), lin(5)];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 delta E between two #rrggbb colours. */
export function deltaE(a, b) {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** The smallest delta E from this colour to any catalog skin tone. */
export function skinDistance(hex) {
  return Math.min(...SKIN_HEXES.map((s) => deltaE(hex, s)));
}

/**
 * The k-th generated palette of a tier (k = 0, 1, 2, ...): endless, deterministic, hue by golden-ratio steps. A hue whose colour
 * lands within SKIN_CLEARANCE of a skin tone is stepped on (by 0.07 of the wheel) until it clears.
 */
export function proceduralPalette(tier, k) {
  const spec = G.tiers[tier].generated;
  let hue = (0.137 + k * 0.6180339887 + GEAR_TIERS.indexOf(tier) * 0.31) % 1;
  let c1 = hslHex(hue, spec.saturation, spec.lightness);
  for (let guard = 0; skinDistance(c1) < SKIN_CLEARANCE; guard++) {
    if (guard > 14) throw new Error(`no hue clears the skin tones for tier ${tier}`);
    hue = (hue + 0.07) % 1;
    c1 = hslHex(hue, spec.saturation, spec.lightness);
  }
  return { name: `${G.hueNames[Math.floor(hue * G.hueNames.length)]} ${k + 1}`, c1, c2: G.generatedTrim[k % G.generatedTrim.length] };
}

function recipesFor(tier, body, palette, owned) {
  const spec = G.tiers[tier];
  const out = [];
  for (const slot of spec.slots) {
    if (slot !== "board" && !BODY_SLOTS[body].includes(slot)) continue;
    for (const pattern of spec.patterns) {
      const r = { slot, body: slot === "board" ? null : body, pattern, color: palette.c1.toLowerCase(), color2: palette.c2.toLowerCase(), tier, name: palette.name };
      if (!owned.has(recipeId(r))) out.push(r);
    }
  }
  return out;
}

/**
 * The kit partner of a piece won by the male body: the board shorts for a board, the board for board shorts, in the same
 * pattern, colours and tier. null for anything else (women's gear is already a set).
 */
export function kitPartner(r, body) {
  if (body !== "male") return null;
  if (r.slot === "board") return { ...r, slot: "bottom", body: "male" };
  if (r.slot === "bottom" && r.body === "male") return { ...r, slot: "board", body: null };
  return null;
}

/** Chance that a male win comes as a kit (tour.json gear.kit.chance). */
export const KIT_CHANCE = G.kit.chance;

/**
 * Pick a piece of exactly this tier for this body that is not yet owned. Table palettes first, uniformly over what is left;
 * when the table is used up, generated palettes (endless) are tried in order. Never returns a piece for the other body.
 * Throws if the tier is unknown.
 */
export function drawRecipe(tier, body, owned, rand) {
  if (!G.tiers[tier]) throw new Error(`unknown gear tier "${tier}"`);
  if (!BODIES.includes(body)) throw new Error(`unknown body "${body}"`);
  const table = [];
  for (const palette of G.tiers[tier].palettes) table.push(...recipesFor(tier, body, palette, owned));
  if (table.length) return table[Math.floor(rand() * table.length)];
  for (let k = 0; ; k++) {
    const options = recipesFor(tier, body, proceduralPalette(tier, k), owned);
    if (options.length) return options[Math.floor(rand() * options.length)];
  }
}

/** Every distinct colour the generator can hand out from its tables (for the renderer's colour calibration). */
export function tableColours() {
  const set = new Set();
  for (const spec of Object.values(G.tiers)) for (const p of spec.palettes) { set.add(p.c1.toLowerCase()); set.add(p.c2.toLowerCase()); }
  return [...set];
}

export const gearTables = G;
