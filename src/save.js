import catalog from "./data/catalog.json" with { type: "json" };
import { KIT_CHANCE, drawRecipe, kitPartner, migrateRecipe, recipeId, recipeToItem } from "./gear.js";
import { PITY_LIMIT, SEASON_LENGTH, TIERS, advances, eventNumber, isFinale, pointsFor, rankInfo, rewardTier, seasonEvent, tuning } from "./season.js";
import { mulberry32 } from "./competition.js";

// Save version 2 lives under its own key. The version 1 key is read once for migration and never written or deleted, so an
// older build still finds its own save.
export const SAVE_KEY = "endless-swell-save-v2";
export const LEGACY_SAVE_KEY = "endless-swell-save-v1";
export const SAVE_VERSION = 2;

// Clear genders (decisions.md, 2026-10-21): the game has a male body and a female body, and every outfit item is made
// for exactly one of them (item.body). Boards belong to neither. Nothing here ever puts or grants an item on the
// wrong body. Ed, 2026-10-21: men wear no shirts and no suits (board shorts and a board only); every outfit is a matching set,
// one item with one pattern and one colour pair, so a loadout is a body, a skin, one outfit and a board (no separate top).
export const BODY_IDS = catalog.bodies.map((b) => b.id);
// every outfit style, each one item: trunks (male), bikini (top and bottom), rashset (rashguard and bottom), fullsuit, springsuit
const OUTFIT_STYLES = ["trunks", "bikini", "rashset", "fullsuit", "springsuit"];

// Earned gear won by placement is generated (src/gear.js) and saved as a recipe; its catalog-shaped item is registered here.
// The id is the recipe itself, so the registry is the same for every save in the process.
const generated = new Map();

/** Register the item a saved or freshly drawn recipe stands for. Throws if the recipe is not a valid earned piece. */
export function registerGear(recipe) {
  const item = recipeToItem(recipe);
  generated.set(item.id, item);
  return item;
}

export function allItems() {
  return [...catalog.bodies, ...catalog.outfits, ...catalog.boards, ...generated.values()];
}

/** id -> item for everything wearable, catalog and generated; the surfer and the Locker read this. */
export function itemMap() {
  return Object.fromEntries(allItems().map((i) => [i.id, i]));
}

function itemById(id) {
  return generated.get(id) || [...catalog.bodies, ...catalog.outfits, ...catalog.boards].find((i) => i.id === id) || null;
}

export function isBody(id) {
  return BODY_IDS.includes(id);
}

// Outfit items made for one body.
export function outfitsFor(body) {
  if (!isBody(body)) throw new Error(`unknown body "${body}"`);
  return [...catalog.outfits, ...generated.values()].filter((i) => i.body === body);
}

export function boardsAll() {
  return [...catalog.boards, ...[...generated.values()].filter((i) => i.shape)];
}

export function bottomsFor(body) {
  return outfitsFor(body).filter((i) => OUTFIT_STYLES.includes(i.style));
}

export function defaultBottom(body) {
  const spec = catalog.bodies.find((b) => b.id === body);
  if (!spec) throw new Error(`unknown body "${body}"`);
  const item = itemById(spec.defaultBottom);
  if (!item || item.body !== body) throw new Error(`catalog defaultBottom "${spec.defaultBottom}" is not an outfit for the ${body} body`);
  return item.id;
}

export function defaultOwned() {
  return allItems().filter((i) => i.ownedDefault).map((i) => i.id);
}

export function defaultSave() {
  return {
    v: SAVE_VERSION,
    season: 1,
    event: 1,
    attempt: 0,
    points: 0,
    pity: 0,
    draws: 0,
    trophies: [],
    gear: [],
    results: [],
    owned: defaultOwned(),
    loadout: {
      body: "male",
      skin: "#6e3a22",
      bottom: defaultBottom("male"),
      board: "board-blue",
    },
    quality: "high",
    best: 0,
    playLog: emptyPlayLog(),
  };
}

// ---- the play log --------------------------------------------------------------------------------------------------
// What the player really did, kept in the save (never sent anywhere) so the difficulty can be tuned from real play: one
// record per wave ridden and one per heat. Capped to the last maxWaves waves and maxHeats heats (tour.json "playLog").
// Shift+L in the game exports it (src/playlog.js).
const PLAYLOG = tuning.playLog;
export const PLAYLOG_VERSION = PLAYLOG.version;
export const PLAYLOG_MAX_WAVES = PLAYLOG.maxWaves;
export const PLAYLOG_MAX_HEATS = PLAYLOG.maxHeats;

export function emptyPlayLog() {
  return { v: PLAYLOG_VERSION, waves: [], heats: [] };
}

function num(v, digits = 2) {
  return Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : 0;
}

function numOrNull(v) {
  return Number.isFinite(v) ? v : null;
}

function strOrNull(v) {
  return typeof v === "string" ? v : null;
}

/** The parts of one wave score as numbers only (a wipe has just {partial}; a forgiven wipe and a ridden wave have more). */
function cleanParts(parts) {
  const out = {};
  if (parts && typeof parts === "object") for (const [k, v] of Object.entries(parts)) if (Number.isFinite(v)) out[k] = num(v);
  return out;
}

/** One wave record in its saved shape; sanitize() runs every stored record through this too, so a record can never be malformed. */
function cleanWave(w) {
  return {
    at: Number.isFinite(w.at) ? w.at : 0,
    season: numOrNull(w.season),
    event: numOrNull(w.event),
    attempt: numOrNull(w.attempt),
    round: strOrNull(w.round),
    wave: numOrNull(w.wave),
    score: num(w.score, 1),
    parts: cleanParts(w.parts),
    rideSeconds: num(w.rideSeconds, 1),
    tubeSeconds: num(w.tubeSeconds, 1),
    wipe: !!w.wipe,
    cause: strOrNull(w.cause),
    forgiven: !!w.forgiven,
    interference: !!w.interference,
    clean: !!w.clean,
    spit: !!w.spit,
  };
}

function cleanScores(list) {
  return (Array.isArray(list) ? list : []).filter((x) => Number.isFinite(x)).map((x) => num(x, 1));
}

function cleanHeat(h) {
  return {
    at: Number.isFinite(h.at) ? h.at : 0,
    season: numOrNull(h.season),
    event: numOrNull(h.event),
    attempt: numOrNull(h.attempt),
    round: strOrNull(h.round),
    rival: strOrNull(h.rival),
    rivalSkill: num(h.rivalSkill, 3),
    playerTotal: num(h.playerTotal, 1),
    rivalTotal: num(h.rivalTotal, 1),
    playerWaves: cleanScores(h.playerWaves),
    rivalWaves: cleanScores(h.rivalWaves),
    won: !!h.won,
    place: numOrNull(h.place),
    eventPlace: numOrNull(h.eventPlace),
  };
}

function sanitizePlayLog(raw) {
  const log = emptyPlayLog();
  if (!raw || typeof raw !== "object" || raw.v !== PLAYLOG_VERSION) return log;
  const records = (list) => (Array.isArray(list) ? list.filter((r) => r && typeof r === "object") : []);
  log.waves = records(raw.waves).slice(-PLAYLOG_MAX_WAVES).map(cleanWave);
  log.heats = records(raw.heats).slice(-PLAYLOG_MAX_HEATS).map(cleanHeat);
  return log;
}

/** Append one wave record (see cleanWave for the fields) and trim to the cap. Returns the stored record. */
export function logWave(save, wave) {
  if (!save.playLog) save.playLog = emptyPlayLog();
  const rec = cleanWave(wave);
  save.playLog.waves.push(rec);
  if (save.playLog.waves.length > PLAYLOG_MAX_WAVES) save.playLog.waves.splice(0, save.playLog.waves.length - PLAYLOG_MAX_WAVES);
  return rec;
}

/** Append one heat record (see cleanHeat for the fields) and trim to the cap. Returns the stored record. */
export function logHeat(save, heat) {
  if (!save.playLog) save.playLog = emptyPlayLog();
  const rec = cleanHeat(heat);
  save.playLog.heats.push(rec);
  if (save.playLog.heats.length > PLAYLOG_MAX_HEATS) save.playLog.heats.splice(0, save.playLog.heats.length - PLAYLOG_MAX_HEATS);
  return rec;
}

/** When an event is settled, stamp its final placement on the last heat logged for that event. Returns the heat or null. */
export function logEventPlace(save, place) {
  const heats = save.playLog?.heats;
  if (!heats || !heats.length) return null;
  const last = heats[heats.length - 1];
  last.eventPlace = place;
  return last;
}

/** The log as the plain object Shift+L writes to a file: the save's place in the tour, the wave and heat records. */
export function exportPlayLog(save, now = Date.now()) {
  const log = save.playLog || emptyPlayLog();
  return {
    game: "endless-swell",
    kind: "play-log",
    version: PLAYLOG_VERSION,
    exportedAt: now,
    exportedAtIso: new Date(now).toISOString(),
    progress: { season: save.season, event: save.event, attempt: save.attempt, points: save.points },
    waves: log.waves,
    heats: log.heats,
  };
}

// The same outfit for another body: the item of the same family made for that body, or null (men have no rashguard or suit).
export function counterpart(item, body) {
  if (!item) return null;
  if (item.body === body) return item;
  if (!item.family) return null;
  return catalog.outfits.find((o) => o.family === item.family && o.body === body) || null;
}

// Ids saved before outfits were gendered ("rash-white", "onesie-blue") belong to a family; the item for a body is the
// family member made for it, or null when that body has none (men have no rashguard or suit). Returns the catalog item, or
// null if id is not a legacy id or the body has no member.
function legacyItem(id, body) {
  const family = catalog.legacyIds[id];
  if (!family) return null;
  return catalog.outfits.find((o) => o.family === family && o.body === body) || null;
}

/**
 * Change the body and carry the loadout across: the same outfit for the new body when it exists and is owned (a women's
 * fullsuit has no men's counterpart), otherwise that body's default outfit. Never leaves an item on a body it was not made for.
 */
export function switchBody(save, body) {
  if (!isBody(body)) throw new Error(`unknown body "${body}"`);
  const load = save.loadout;
  const bottom = counterpart(itemById(load.bottom), body);
  load.body = body;
  load.bottom = bottom && owns(save, bottom.id) && OUTFIT_STYLES.includes(bottom.style) ? bottom.id : defaultBottom(body);
}

/** Put an owned item in its slot. Throws if the item is not made for the loadout's body. */
export function equipItem(save, id) {
  const item = itemById(id);
  if (!item) throw new Error(`equip: "${id}" is not in the catalog`);
  if (!owns(save, id)) return false;
  if (isBody(id)) {
    switchBody(save, id);
    return true;
  }
  if (item.shape) {
    save.loadout.board = id;
    return true;
  }
  if (item.body !== save.loadout.body) {
    throw new Error(`equip: "${id}" is made for the ${item.body} body, the surfer is the ${save.loadout.body} body`);
  }
  if (!OUTFIT_STYLES.includes(item.style)) throw new Error(`equip: "${id}" has unknown style "${item.style}"`);
  save.loadout.bottom = id;
  return true;
}

const KNOWN_PLACES = Object.keys(tuning.points.byPlace);

// Version 1 saved only the next tour number and the last 40 results. Map them onto seasons: tour n is season
// floor((n-1)/10)+1, event ((n-1)%10)+1. Points and Finale trophies are rebuilt from the results that survive.
function migrateV1(data) {
  const n = Number.isFinite(data.nextTour) && data.nextTour >= 1 ? Math.floor(data.nextTour) : 1;
  const { season, event } = seasonEvent(n);
  const results = [];
  const trophies = [];
  let points = 0;
  for (const r of Array.isArray(data.results) ? data.results.slice(-40) : []) {
    if (!r || !Number.isInteger(r.tour) || r.tour < 1 || !KNOWN_PLACES.includes(String(r.place))) continue;
    const at = Number.isFinite(r.at) ? r.at : 0;
    const se = seasonEvent(r.tour);
    results.push({ n: r.tour, season: se.season, event: se.event, place: r.place, at });
    points += pointsFor(r.place, isFinale(se.event));
    if (isFinale(se.event) && advances(r.place)) trophies.push({ season: se.season, place: r.place, at });
  }
  return { season, event, attempt: 0, points, pity: 0, draws: 0, trophies, gear: [], results };
}

function intAtLeast(v, min, fallback) {
  return Number.isFinite(v) && v >= min ? Math.floor(v) : fallback;
}

function readProgress(data) {
  const version = Number.isFinite(data.v) ? data.v : 1;
  if (version < 2) return migrateV1(data);
  const season = intAtLeast(data.season, 1, 1);
  const event = Number.isInteger(data.event) && data.event >= 1 && data.event <= SEASON_LENGTH ? data.event : 1;
  const trophies = (Array.isArray(data.trophies) ? data.trophies : [])
    .filter((t) => t && Number.isInteger(t.season) && t.season >= 1 && KNOWN_PLACES.includes(String(t.place)) && advances(t.place))
    .map((t) => ({ season: t.season, place: t.place, at: Number.isFinite(t.at) ? t.at : 0 }));
  const results = (Array.isArray(data.results) ? data.results : [])
    .filter((r) => r && Number.isInteger(r.season) && Number.isInteger(r.event) && KNOWN_PLACES.includes(String(r.place)))
    .slice(-40)
    .map((r) => ({ n: eventNumber(r.season, r.event), season: r.season, event: r.event, place: r.place, at: Number.isFinite(r.at) ? r.at : 0 }));
  return {
    season,
    event,
    attempt: intAtLeast(data.attempt, 0, 0),
    points: intAtLeast(data.points, 0, 0),
    pity: intAtLeast(data.pity, 0, 0),
    draws: intAtLeast(data.draws, 0, 0),
    trophies,
    gear: Array.isArray(data.gear) ? data.gear : [],
    results,
  };
}

function sanitize(data) {
  const base = defaultSave();
  if (!data || typeof data !== "object") return base;
  const progress = readProgress(data);
  const body = isBody(data.loadout?.body) ? data.loadout.body : "male";
  const owned = new Set(base.owned);
  // Saved gear is a list of recipes. A recipe that is not a valid earned piece is dropped with a console warning; it is
  // never turned into a different piece.
  const gear = [];
  const recipeIds = new Set();
  const renamed = new Map(); // id of a recipe as an earlier build saved it -> its id now
  for (const saved of progress.gear) {
    try {
      const recipe = migrateRecipe(saved);
      if (!recipe) {
        console.warn(`save: dropped a piece the game no longer has (${saved.slot} for the ${saved.body} body: men wear board shorts and a board only)`);
        continue;
      }
      const item = registerGear(recipe);
      if (recipe !== saved) renamed.set(recipeId({ ...saved, body: saved.body || null }), item.id);
      if (!recipeIds.has(item.id)) {
        recipeIds.add(item.id);
        gear.push({ slot: recipe.slot, body: recipe.slot === "board" ? null : recipe.body, pattern: recipe.pattern, color: recipe.color, color2: recipe.color2, tier: recipe.tier, name: recipe.name });
      }
    } catch (e) {
      console.warn(`save: dropped an invalid gear recipe (${e.message})`);
    }
  }
  // owned keeps the saved order (the Locker lists the newest gear first); generated ids count only if a valid recipe backs them
  if (Array.isArray(data.owned)) {
    for (const saved of data.owned) {
      const id = renamed.get(saved) || saved;
      if (typeof id === "string" && id.startsWith("gen:")) {
        if (recipeIds.has(id)) owned.add(id);
      } else if (itemById(id)) owned.add(id);
      else if (catalog.legacyIds[id]) {
        // an item owned before outfits were gendered was owned for both bodies: keep the member each body still has
        for (const b of BODY_IDS) {
          const member = legacyItem(id, b);
          if (member) owned.add(member.id);
        }
      }
    }
  }
  for (const id of recipeIds) owned.add(id);
  const load = data.loadout || {};
  const pick = (id, want) => {
    const item = itemById(renamed.get(id) || id) || legacyItem(id, body);
    return item && item.body === body && owned.has(item.id) && want(item) ? item.id : null;
  };
  // An earlier build saved a top and a bottom separately. Men's tops and suits are gone (the male loadout keeps its board shorts);
  // a woman who wore a rashguard now wears the matching rashguard set.
  const worn = pick(load.top, (i) => i.style === "rashset") || pick(load.bottom, (i) => OUTFIT_STYLES.includes(i.style));
  const next = {
    ...base,
    season: progress.season,
    event: progress.event,
    attempt: progress.attempt,
    points: progress.points,
    pity: progress.pity,
    draws: progress.draws,
    trophies: progress.trophies,
    gear,
    results: progress.results,
    owned: [...owned],
    quality: data.quality === "low" ? "low" : "high",
    best: Number.isFinite(data.best) ? data.best : 0,
    playLog: sanitizePlayLog(data.playLog),
    loadout: {
      body,
      skin: typeof load.skin === "string" ? load.skin : base.loadout.skin,
      bottom: worn || defaultBottom(body),
      board: owned.has(load.board) && itemById(load.board)?.shape ? load.board : "board-blue",
    },
  };
  return next;
}

/** The save for this browser: version 2 if there is one, else the version 1 save migrated, else a new save. Parse errors are logged and start a new save. */
export function loadSave() {
  let raw = null;
  let legacy = false;
  try {
    raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_SAVE_KEY);
      legacy = !!raw;
    }
  } catch (e) {
    console.error("save: localStorage is not readable, starting a new save", e);
    return defaultSave();
  }
  if (!raw) return defaultSave();
  try {
    const parsed = JSON.parse(raw);
    if (legacy) parsed.v = 1;
    return sanitize(parsed);
  } catch (e) {
    console.error(`save: the ${legacy ? "version 1" : "version 2"} save could not be read, starting a new save`, e);
    return defaultSave();
  }
}

export { sanitize };

export function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("save: could not write to localStorage", e);
    return false;
  }
}

export function owns(save, id) {
  return save.owned.includes(id);
}

/**
 * Grant one piece of gear of exactly this tier (the old "tier is a minimum" rule could hand a common win the epic board).
 * Authored catalog pieces of the tier come first; when none are left a piece is generated. The piece is for the surfer
 * being played: an outfit made for the other body is never granted. Boards are for both. Returns the item. A male win may come
 * as a kit (tour.json gear.kit): the matching board (for board shorts) or board shorts (for a board) is granted with it, and
 * out.kit is set to that second item.
 */
export function grantReward(save, tier, rand, out = {}) {
  if (!TIERS.includes(tier)) throw new Error(`grantReward: unknown tier "${tier}"`);
  out.kit = null;
  const body = save.loadout.body;
  const authored = catalog.outfits
    .concat(catalog.boards)
    .filter((item) => item.tier !== "premium" && item.reward === tier && !save.owned.includes(item.id) && (!item.body || item.body === body));
  if (authored.length) {
    const pick = authored[Math.floor(rand() * authored.length)];
    save.owned.push(pick.id);
    return pick;
  }
  const recipe = drawRecipe(tier, body, new Set(save.owned), rand);
  const item = registerGear(recipe);
  if (save.owned.includes(item.id)) throw new Error(`grantReward: drew ${item.id}, which is already owned`);
  save.gear.push(recipe);
  save.owned.push(item.id);
  out.kit = null;
  if (rand() < KIT_CHANCE) {
    const partner = kitPartner(recipe, body);
    if (partner && !save.owned.includes(recipeId(partner))) {
      const second = registerGear(partner);
      save.gear.push(partner);
      save.owned.push(second.id);
      out.kit = second;
    }
  }
  return item;
}

function drawSeed(season, event, attempt, draws) {
  let h = Math.imul(season, 0x9e3779b1) ^ Math.imul(event + 1, 0x85ebca6b) ^ Math.imul(attempt + 1, 0xc2b2ae35) ^ Math.imul(draws + 1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
}

/**
 * Book the result of the event the save is on. `place` is 1, 2, 4, 8 or 16. Points always pay and only go up. A top-4 finish
 * advances (Decision 1); anything else leaves the player on the same event for another attempt. Gear comes from the season's
 * reward band, with the pity counter as a floor. A top-4 finish in a Season Finale adds a trophy. Mutates `save` and
 * returns what happened, for the results screen. Does not write the save to storage.
 */
export function settleFinish(save, place) {
  const { season, event } = save;
  const finale = isFinale(event);
  const before = rankInfo(save.points);
  const points = pointsFor(place, finale);
  const rand = mulberry32(drawSeed(season, event, save.attempt, save.draws));
  save.draws += 1;
  let tier = rewardTier(season, place, rand);
  let pityGuarantee = false;
  if (!tier && save.pity >= PITY_LIMIT) {
    tier = "common";
    pityGuarantee = true;
  }
  const out = {};
  const gear = tier ? grantReward(save, tier, rand, out) : null;
  save.pity = gear ? 0 : save.pity + 1;
  save.points += points;
  const advanced = advances(place);
  const at = Date.now();
  let trophy = null;
  if (finale && advanced) {
    trophy = { season, place, at };
    save.trophies.push(trophy);
  }
  save.results.push({ n: eventNumber(season, event), season, event, place, at });
  save.results = save.results.slice(-40);
  const done = { season, event, attempt: save.attempt };
  let newSeason = false;
  if (advanced) {
    save.attempt = 0;
    if (finale) {
      save.season += 1;
      save.event = 1;
      newSeason = true;
    } else save.event += 1;
  } else save.attempt += 1;
  return {
    ...done,
    finale,
    place,
    advanced,
    points,
    gear,
    kit: out.kit || null,
    tier,
    pityGuarantee,
    trophy,
    newSeason,
    rankBefore: before,
    rankAfter: rankInfo(save.points),
    next: { season: save.season, event: save.event },
  };
}

export { catalog, recipeId };
