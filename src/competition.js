import { clamp } from "./wave.js";
import locations from "./data/locations.json" with { type: "json" };
import tourData from "./data/tour.json" with { type: "json" };
import { SEASON_LENGTH, isFinale, seasonEvent } from "./season.js";

const FIRST = ["Kai", "Noa", "Leilani", "Mateo", "Hina", "Ari", "Sefa", "Nalani", "Ikaia", "Tane", "Moana", "Keoni", "Aroha", "Rafa", "Nico", "Sienna", "Omar", "Lea", "Pia", "Hugo", "Amaia", "Teva", "Ines", "Luca", "Noe", "Malia", "Koa", "Anika", "Rio", "Soren", "Yara", "Eli", "Pablo", "Aya", "June", "Tao", "Mika", "Ona", "Remy", "Idris"];
const LAST = ["Mendes", "Brooks", "Silva", "Nguyen", "Costa", "Ibarra", "Okada", "Berg", "Diallo", "Moreau", "Sato", "Almeida", "Kruger", "Abebe", "Rossi", "Nadir", "Petrova", "Hale", "Quintana", "Okafor", "Lind", "Marin", "Cho", "Duval", "Bennett", "Ferreira", "Novak", "Amini", "Keller", "Souza"];

export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function waveForFeet(feet, diff) {
  const height = clamp(feet / 14.6, 0.32, 1.14);
  const curl = clamp(0.66 + ((feet - 4) / 11) * 0.46 + diff * 0.05, 0.66, 1.2);
  const tight = clamp((feet - 5.5) / 13, 0, 0.88);
  const peelSpeed = 8.6 + feet * 0.3;
  return { height, curl, tight, peelSpeed };
}

export const locationById = Object.fromEntries(locations.map((l) => [l.id, l]));

// ---- the difficulty sawtooth ---------------------------------------------------------------------------------------
const CURVE = tourData.curve;

// 0 in season 1, rising toward 1 and never reaching it: 1 - 1/(1 + (s-1)/K).
function approach(season) {
  return 1 - 1 / (1 + (season - 1) / CURVE.approachK);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * The two dials the sawtooth sets for an event: the rivals' base skill and the swell in feet (unrounded). A season starts at
 * start(s), climbs in a straight line over events 1..L-1 to peak(s), and the Finale adds a small bump on top of the peak.
 * start(s) and peak(s) rise from season to season toward their limits; each start is far below the previous peak.
 */
export function eventDials(season, event) {
  const g = approach(season);
  const climb = clamp((event - 1) / (SEASON_LENGTH - 2), 0, 1);
  const finale = isFinale(event);
  const skill = CURVE.skill;
  const feet = CURVE.feet;
  const skillStart = lerp(skill.floor, skill.startLimit, g);
  const skillPeak = lerp(skill.peakFirst, skill.peakLimit, g);
  const feetStart = lerp(feet.floor, feet.startLimit, g);
  const feetPeak = lerp(feet.peakFirst, feet.peakLimit, g);
  return {
    skill: lerp(skillStart, skillPeak, climb) + (finale ? skill.finaleBump : 0),
    feet: Math.min(feet.hardCap, lerp(feetStart, feetPeak, climb) + (finale ? feet.finaleBump : 0)),
  };
}

// ---- rule twists ---------------------------------------------------------------------------------------------------
const TWISTS = tourData.twists;

export function twistLabel(id) {
  const def = TWISTS.defs[id];
  if (!def) throw new Error(`unknown twist "${id}"`);
  return def.label;
}

/** The twist a season carries from season `seasonTwistFrom` on: blocks of all of them in a seeded order, none repeats inside a block. */
export function seasonTwist(season) {
  const idx = season - TWISTS.seasonTwistFrom;
  if (idx < 0) return null;
  const order = TWISTS.order;
  const block = Math.floor(idx / order.length);
  return shuffle(order, mulberry32(Math.imul(block + 1, 0x9e3779b1) + 5))[idx % order.length];
}

/** The twists on in an event: the season twist, then the fixed mid-season special for the event number, no duplicates. */
export function activeTwists(season, event) {
  const list = [];
  const seasonal = seasonTwist(season);
  if (seasonal) list.push(seasonal);
  const special = TWISTS.eventTwists[String(event)];
  if (special && !list.includes(special)) list.push(special);
  if (list.length > TWISTS.maxActive) throw new Error(`season ${season} event ${event} has ${list.length} twists, the cap is ${TWISTS.maxActive}`);
  return list;
}

// ---- the location calendar -----------------------------------------------------------------------------------------
const CAL = tourData.calendar;
const calendars = new Map();

/**
 * A season's ten stops (location ids, index 0 is event 1), seeded by the season number so every season is a different order.
 * The home break opens the season and is the Finale; two premium stops sit in the middle, never adjacent; the other free
 * breaks fill some of the rest. Pure: the same season always gives the same calendar.
 */
export function seasonCalendar(season) {
  if (!Number.isInteger(season) || season < 1) throw new Error(`season must be an integer >= 1, got ${season}`);
  if (calendars.has(season)) return calendars.get(season).slice();
  const rand = mulberry32(Math.imul(season, 0x27d4eb2f) + 99);
  const stops = new Array(SEASON_LENGTH).fill(CAL.home);
  const premiumIds = shuffle(locations.filter((l) => l.tier === "premium").map((l) => l.id), rand);
  const events = [];
  for (let e = CAL.premiumFrom; e <= CAL.premiumTo; e++) events.push(e);
  const chosen = [];
  for (const e of shuffle(events, rand)) {
    if (chosen.length >= CAL.premiumStops) break;
    if (chosen.every((c) => Math.abs(c - e) > 1)) chosen.push(e);
  }
  if (chosen.length < CAL.premiumStops || premiumIds.length < CAL.premiumStops) throw new Error("calendar: not enough premium breaks or event slots for premiumStops");
  chosen.forEach((e, i) => { stops[e - 1] = premiumIds[i]; });
  const secondary = locations.filter((l) => l.id !== CAL.home && l.tier !== "premium").map((l) => l.id);
  if (secondary.length) {
    const open = [];
    for (let e = 2; e < SEASON_LENGTH; e++) if (!chosen.includes(e)) open.push(e);
    shuffle(open, rand).slice(0, CAL.secondaryStops).forEach((e, i) => { stops[e - 1] = secondary[i % secondary.length]; });
  }
  calendars.set(season, stops);
  return stops.slice();
}

/** "open" (built, playable), "locked" (for sale, not built), or "soon" (free, not built yet). A stop that is not "open" is played on the home break. */
export function stopStatus(loc) {
  if (loc.realized) return "open";
  return loc.tier === "premium" ? "locked" : "soon";
}

function eventSeed(season, event) {
  return (Math.imul(season, 0x9e3779b1) ^ Math.imul(event + 7, 0x85ebca6b)) + 17;
}

const HEAT = tourData.heat;

/**
 * The event for level number n (n >= 1). n maps to a season and an event, and the seed takes the season in, so the same
 * event of another season has other rivals, hazards and weather. Deterministic: n always gives the same event.
 */
export function generateTour(n) {
  const { season, event } = seasonEvent(n);
  const finale = isFinale(event);
  const rand = mulberry32(eventSeed(season, event));
  const dials = eventDials(season, event);
  const feet = Math.round(dials.feet * 10) / 10;
  const diff = clamp((feet - CURVE.feet.floor) / CURVE.feet.diffSpan, 0, 1);
  const wave = waveForFeet(feet, diff);
  const twists = activeTwists(season, event);
  const has = (id) => twists.includes(id);
  const defs = twists.map((id) => TWISTS.defs[id]);
  const waveCap = Math.min(HEAT.waves, ...defs.map((d) => d.waveCap ?? HEAT.waves));
  const heatSeconds = Math.min(HEAT.seconds, ...defs.map((d) => d.heatSeconds ?? HEAT.seconds));
  const aiSkip = Math.max(HEAT.aiSkip, ...defs.map((d) => d.aiSkip ?? 0));
  const reefLift = Math.max(0, ...defs.map((d) => d.reefLift ?? 0));
  const extraReef = Math.max(0, ...defs.map((d) => d.extraReef ?? 0));

  // Side-shore wind is only a name when a twist makes it matter, so the random wind never rolls it.
  const windNames = ["light", "offshore", "onshore"];
  let windName = windNames[Math.floor(rand() * windNames.length)];
  let wind = windName === "onshore" ? 0.5 + rand() * 0.35 : windName === "light" ? rand() * 0.12 : 0.12 + rand() * 0.22;
  let windPush = 0;
  if (has("sideshore-wind")) {
    windName = "sideshore";
    wind = 0.12 + rand() * 0.22;
    windPush = defs[twists.indexOf("sideshore-wind")].windPush; // negative: down the face, toward the trough, which gravity already pulls the board
  }
  const tide = ["low", "mid", "high"][Math.floor(rand() * 3)];
  let look = "day";
  if (n >= 16 && n % 7 === 0) look = "storm";
  else if (n >= 12 && (n % 9 === 0 || rand() < 0.1)) look = "night";
  else if (n >= 8 && (n % 5 === 0 || rand() < 0.18)) look = "golden";

  // Hazards ramp with the level number for the first rampSeasons seasons, then stay where they ended.
  const hn = Math.min(n, tourData.hazards.rampSeasons * SEASON_LENGTH);
  const sharks = [];
  if (hn >= 3) {
    const count = Math.min(4, 1 + Math.floor((hn - 3) / 6));
    for (let i = 0; i < count; i++) {
      sharks.push({ s: 0.24 + rand() * 0.42, z: -30 - i * 34 - rand() * 8, wobble: rand() * 6.28 });
    }
  }
  const reef = [];
  if (hn >= 2) {
    const count = (hn >= 9 ? 2 : 1) + extraReef;
    for (let i = 0; i < count; i++) {
      const hi = -48 - i * 55 - rand() * 6;
      reef.push({ z0: hi, z1: hi - (16 + rand() * 10) });
    }
  }
  const zones = [];
  if (hn >= 4) {
    const count = Math.min(3, 1 + Math.floor((hn - 4) / 9));
    for (let i = 0; i < count; i++) {
      const hi = -38 - i * 46;
      zones.push({ z0: hi, z1: hi - 18, power: clamp(0.5 + hn / 90, 0.5, 0.95) });
    }
  }
  const boards = [];
  if (hn >= 5) {
    const count = Math.min(3, 1 + Math.floor((hn - 5) / 10));
    for (let i = 0; i < count; i++) boards.push({ s: 0.22 + rand() * 0.36, z: -36 - i * 32, wobble: rand() * 4 });
  }

  const locationId = seasonCalendar(season)[event - 1];
  const playedId = locationById[locationId].realized ? locationId : CAL.home;

  const namePool = shuffle(FIRST, rand).slice(0, 15).map((f, i) => `${f} ${LAST[(i * 3 + n) % LAST.length]}`);
  const rivals = namePool.map((name) => ({
    name,
    skill: clamp(dials.skill + (rand() - 0.5) * CURVE.skill.rivalJitter, 0.1, CURVE.skill.rivalCap),
    isPlayer: false,
  }));

  return {
    n,
    season,
    event,
    finale,
    diff,
    feet,
    skill: dials.skill,
    ...wave,
    wind,
    windName,
    windPush,
    tide,
    look,
    twists,
    waveCap,
    heatSeconds,
    aiSkip,
    reefLift,
    sharks,
    reef,
    zones,
    boards,
    locationId,
    playedId,
    rivals,
  };
}

export function hasTwist(cond, id) {
  return !!cond && Array.isArray(cond.twists) && cond.twists.includes(id);
}

export function judgeWave(stats, cond) {
  if (!stats || !stats.samples) return { total: 0, wipe: !!stats?.wipe, parts: {} };
  const avgSpeed = stats.speedSum / stats.samples;
  const avgS = stats.sSum / stats.samples;
  const variance = Math.max(0, stats.speedSq / stats.samples - avgSpeed * avgSpeed);
  const cv = Math.sqrt(variance) / Math.max(avgSpeed, 0.1);
  const flowScore = clamp(1.2 - cv * 2.6, 0, 1);
  if (stats.wipe) {
    const partial = clamp(stats.tubeTime * 0.22 + stats.committed * 0.12, 0, 2.2);
    return { total: Math.round(partial * 10) / 10, wipe: true, parts: { partial } };
  }
  const tube = clamp(stats.tubeTime * 0.32 + stats.deepTime * 0.26, 0, 3.35);
  const commit = clamp((avgS - 0.16) * 3.1 + ((cond.feet || 8) - 4) / 16 * 0.7 + stats.committed * 0.05, 0, 1.7);
  const speed = clamp((avgSpeed - 6.2) * 0.2 + (stats.maxSpeed - 8) * 0.05, 0, 1.65);
  const flow = clamp(flowScore * 1.15, 0, 1.15);
  const variety = clamp(stats.pumps * 0.16 + stats.turns * 0.11 + Math.min(stats.stalls, 2.2) * 0.14, 0, 1.15);
  const exit = stats.clean ? 1 : 0.2;
  let spit = stats.spit ? 0.8 : 0;
  if (hasTwist(cond, "spit-double")) spit *= 2;
  const total = clamp(tube + commit + speed + flow + variety + exit + spit, 0, 10);
  return {
    total: Math.round(total * 10) / 10,
    wipe: false,
    parts: {
      tube: round(tube),
      commit: round(commit),
      speed: round(speed),
      flow: round(flow),
      variety: round(variety),
      exit: round(exit),
      spit: round(spit),
    },
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export function rivalWave(skill, cond, rand) {
  let s = 2.6 + skill * 6.1 + ((cond.feet || 8) - 4) / 22 + (rand() - 0.5) * (2.1 - skill);
  const wiped = rand() < 0.05 + (1 - skill) * 0.16;
  if (wiped) s = 0.4 + rand() * 1.6;
  if (cond.look === "storm") s -= 0.35;
  if (cond.look === "night") s -= 0.15;
  return { total: Math.round(clamp(s, 0.1, 10) * 10) / 10, wipe: wiped, interference: false };
}

export function aiHeatTotal(skill, cond, rand) {
  const waves = [];
  const cap = cond.waveCap || HEAT.waves;
  const skip = cond.aiSkip ?? HEAT.aiSkip;
  for (let i = 0; i < cap; i++) {
    if (rand() < skip) continue;
    waves.push(rivalWave(skill, cond, rand));
  }
  return tally(waves);
}

function tally(waves) {
  const ranked = waves.map((w) => w.total).sort((a, b) => b - a);
  const best = (ranked[0] || 0) + (ranked[1] || 0);
  return { waves, total: Math.round(best * 10) / 10, counting: ranked.slice(0, 2) };
}

export function bestTwo(waves) {
  return tally(waves).total;
}

function surfer(name, skill, isPlayer) {
  return { name, skill, isPlayer, id: name + (isPlayer ? "-you" : "") };
}

/**
 * The 16-surfer draw for an event. `attempt` is how many times the player has already failed this event: a retry keeps the
 * event (swell, hazards, break, the field of fifteen rivals and their skills) but re-draws the bracket and the dice, so it
 * is a fresh chance and not a replay of a memorised heat.
 */
export function createBracket(tour, attempt = 0) {
  const seed = tour.n * 7919 + 3 + attempt * 104729;
  const rand = mulberry32(seed);
  const rivals = tour.rivals.map((r) => surfer(r.name, r.skill, false));
  const slot = Math.floor(rand() * 16);
  const field = [];
  let ri = 0;
  for (let i = 0; i < 16; i++) {
    if (i === slot) field.push(surfer("You", 0.55, true));
    else field.push(rivals[ri++]);
  }
  const rounds = [makeRound(field, "Round of 16", tour, rand, true)];
  return { rounds, roundIndex: 0, randSeed: seed, attempt, settled: false };
}

function makeRound(field, name, tour, rand, playPlayer) {
  const heats = [];
  for (let i = 0; i < field.length; i += 2) {
    const a = field[i];
    const b = field[i + 1];
    const playerHeat = a.isPlayer || b.isPlayer;
    const heat = { a, b, played: false, scoreA: 0, scoreB: 0, winner: null, player: playerHeat };
    if (!playerHeat || !playPlayer) {
      const sa = aiHeatTotal(a.skill, tour, rand);
      const sb = aiHeatTotal(b.skill, tour, rand);
      heat.scoreA = sa.total;
      heat.scoreB = sb.total;
      heat.winner = sa.total === sb.total ? (rand() < 0.5 ? a : b) : sa.total > sb.total ? a : b;
      heat.played = true;
      heat.simA = sa;
      heat.simB = sb;
    }
    heats.push(heat);
  }
  return { name, heats };
}

export function playerHeat(bracket) {
  const round = bracket.rounds[bracket.roundIndex];
  return round.heats.find((h) => h.player && !h.played) || null;
}

export function finishPlayerHeat(bracket, total) {
  const heat = playerHeat(bracket);
  if (!heat) return null;
  const youAreA = heat.a.isPlayer;
  if (youAreA) heat.scoreA = total;
  else heat.scoreB = total;
  const other = youAreA ? heat.scoreB : heat.scoreA;
  if (!heat.b || heat.a.isPlayer && heat.scoreB === 0 && !heat.simB) {
    // rival score is filled by the live heat, not the sim. Caller passes both.
  }
  heat.played = true;
  heat.winner = total === other ? heat.a : total > other ? (youAreA ? heat.a : heat.b) : youAreA ? heat.b : heat.a;
  return heat;
}

export function recordHeat(heat, playerTotal, rivalTotal) {
  const youAreA = heat.a.isPlayer;
  heat.scoreA = youAreA ? playerTotal : rivalTotal;
  heat.scoreB = youAreA ? rivalTotal : playerTotal;
  heat.played = true;
  heat.winner = heat.scoreA === heat.scoreB ? (heat.a.isPlayer ? heat.a : heat.b) : heat.scoreA > heat.scoreB ? heat.a : heat.b;
  return heat.winner.isPlayer;
}

export function advanceBracket(bracket, tour) {
  const round = bracket.rounds[bracket.roundIndex];
  const winners = round.heats.map((h) => h.winner);
  if (winners.length < 2) return { status: "champion", place: 1 };
  const rand = mulberry32(bracket.randSeed + bracket.roundIndex * 19 + 11);
  const name = winners.length === 8 ? "Quarterfinal" : winners.length === 4 ? "Semifinal" : "Final";
  const playerAlive = winners.some((w) => w.isPlayer);
  if (!playerAlive) {
    const place = winners.length === 8 ? 16 : winners.length === 4 ? 8 : 4;
    return { status: "out", place };
  }
  bracket.rounds.push(makeRound(winners, name, tour, rand, true));
  bracket.roundIndex += 1;
  return { status: "next", place: null, round: name };
}

export function placeFromRound(roundName, won) {
  if (won && roundName === "Final") return 1;
  if (!won && roundName === "Final") return 2;
  if (!won && roundName === "Semifinal") return 4;
  if (!won && roundName === "Quarterfinal") return 8;
  if (!won) return 16;
  return null;
}

export function roundTitle(name) {
  if (name === "Round of 16") return "Round of 16";
  if (name === "Quarterfinal") return "Quarterfinal";
  if (name === "Semifinal") return "Semifinal";
  return "Final";
}
