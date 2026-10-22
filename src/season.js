// Seasons, events, ranking points, rank titles and the placement reward table. Pure functions over src/data/tour.json;
// nothing here touches the save, the DOM or the clock. The internal level number n (1, 2, 3, ...) seeds every event and is
// never shown to the player; the player sees "Season S · Event E".
import tourData from "./data/tour.json" with { type: "json" };

export const SEASON_LENGTH = tourData.season.events;
export const TIERS = ["common", "rare", "epic"];
export const PITY_LIMIT = tourData.rewards.pityLimit;

/** Level number n for season >= 1, event 1..SEASON_LENGTH. */
export function eventNumber(season, event) {
  assertSeasonEvent(season, event);
  return (season - 1) * SEASON_LENGTH + event;
}

/** Season and event for a level number n >= 1. */
export function seasonEvent(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`level number must be an integer >= 1, got ${n}`);
  return { season: Math.floor((n - 1) / SEASON_LENGTH) + 1, event: ((n - 1) % SEASON_LENGTH) + 1 };
}

function assertSeasonEvent(season, event) {
  if (!Number.isInteger(season) || season < 1) throw new Error(`season must be an integer >= 1, got ${season}`);
  if (!Number.isInteger(event) || event < 1 || event > SEASON_LENGTH) throw new Error(`event must be an integer 1..${SEASON_LENGTH}, got ${event}`);
}

export function isFinale(event) {
  return event === SEASON_LENGTH;
}

/** "Season 2 · Event 3". */
export function eventLabel(season, event) {
  assertSeasonEvent(season, event);
  return `Season ${season} · Event ${event}`;
}

/** World Ranking Points for a finish (place 1, 2, 4, 8 or 16). The Season Finale pays the multiplier. */
export function pointsFor(place, finale) {
  const base = tourData.points.byPlace[String(place)];
  if (base === undefined) throw new Error(`unknown finish place ${place}; expected one of ${Object.keys(tourData.points.byPlace).join(", ")}`);
  return Math.round(base * (finale ? tourData.points.finaleMultiplier : 1));
}

/** Top-4 gate (decisions.md, Decision 1): a finish of 4th or better advances. */
export function advances(place) {
  return place <= 4;
}

// ---- ranks ---------------------------------------------------------------------------------------------------------
const RANK_NAMES = tourData.ranks.names;
const RANK_FLOORS = tourData.ranks.floors.slice();
if (RANK_NAMES.length !== RANK_FLOORS.length) throw new Error("tour.json ranks: names and floors differ in length");

function rankFloor(index) {
  while (RANK_FLOORS.length <= index) {
    const prev = RANK_FLOORS[RANK_FLOORS.length - 1];
    RANK_FLOORS.push(Math.round((prev * tourData.ranks.growth) / 10) * 10);
  }
  return RANK_FLOORS[index];
}

export function roman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  const table = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [value, text] of table) while (n >= value) { out += text; n -= value; }
  return out;
}

export function rankTitle(index) {
  if (index < RANK_NAMES.length) return RANK_NAMES[index];
  return `${RANK_NAMES[RANK_NAMES.length - 1]} ${roman(index - RANK_NAMES.length + 2)}`;
}

/** The rank for a points total: index, title, the floor it started at, the next title and the points still needed. */
export function rankInfo(points) {
  if (!Number.isFinite(points) || points < 0) throw new Error(`points must be >= 0, got ${points}`);
  let index = 0;
  while (rankFloor(index + 1) <= points) index++;
  return {
    index,
    title: rankTitle(index),
    floor: rankFloor(index),
    points,
    nextTitle: rankTitle(index + 1),
    nextAt: rankFloor(index + 1),
    toNext: rankFloor(index + 1) - points,
  };
}

// ---- gear by placement ---------------------------------------------------------------------------------------------
function band(season) {
  const found = tourData.rewards.bands.find((b) => season >= b.seasons[0] && season <= b.seasons[1]);
  if (!found) throw new Error(`no reward band for season ${season}`);
  return found;
}

/**
 * The tier of gear a finish earns, or null. The floor tier is certain; each chance is rolled (one rand() per chance, always
 * drawn so the sequence does not depend on earlier rolls) and the highest tier that hits wins.
 */
export function rewardTier(season, place, rand) {
  const entry = band(season).places[String(place)];
  if (!entry) throw new Error(`reward table has no entry for place ${place}`);
  let tier = entry.floor || null;
  for (const chance of entry.chances || []) {
    const hit = rand() < chance.p;
    if (hit && (tier === null || TIERS.indexOf(chance.tier) > TIERS.indexOf(tier))) tier = chance.tier;
  }
  return tier;
}

export const tuning = tourData;
