import { clamp } from "./wave.js";
import locations from "./data/locations.json";

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

export function generateTour(n) {
  const rand = mulberry32(Math.imul(n, 10007) + 17);
  const champ = n % 10 === 0;
  const t = Math.max(0, n - 1);
  let diff = 1 - Math.exp(-t / 3.2);
  diff = diff * 0.72 + (1 - 1 / (1 + t / 28)) * 0.28;
  if (champ) diff = Math.min(1, diff + 0.1);
  let feet = 4 + diff * 11;
  if (champ) feet = Math.min(16.5, feet + 1.5);
  feet = Math.round(feet * 10) / 10;
  const wave = waveForFeet(feet, diff);
  const windNames = ["light", "offshore", "sideshore", "onshore"];
  const windName = windNames[Math.floor(rand() * windNames.length)];
  const wind = windName === "onshore" ? 0.5 + rand() * 0.35 : windName === "light" ? rand() * 0.12 : 0.12 + rand() * 0.22;
  const tide = ["low", "mid", "high"][Math.floor(rand() * 3)];
  let look = "day";
  if (n >= 16 && n % 7 === 0) look = "storm";
  else if (n >= 12 && (n % 9 === 0 || rand() < 0.1)) look = "night";
  else if (n >= 8 && (n % 5 === 0 || rand() < 0.18)) look = "golden";
  let special = null;
  if (champ) special = "championship";
  else if (n % 10 === 5) special = "spit-double";
  else if (n % 8 === 0) special = "priority-strict";

  const sharks = [];
  if (n >= 3) {
    const count = Math.min(4, 1 + Math.floor((n - 3) / 6));
    for (let i = 0; i < count; i++) {
      sharks.push({ s: 0.24 + rand() * 0.42, z: -30 - i * 34 - rand() * 8, wobble: rand() * 6.28 });
    }
  }
  const reef = [];
  if (n >= 2) {
    const count = n >= 9 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const hi = -48 - i * 55 - rand() * 6;
      reef.push({ z0: hi, z1: hi - (16 + rand() * 10) });
    }
  }
  const zones = [];
  if (n >= 4) {
    const count = Math.min(3, 1 + Math.floor((n - 4) / 9));
    for (let i = 0; i < count; i++) {
      const hi = -38 - i * 46;
      zones.push({ z0: hi, z1: hi - 18, power: clamp(0.5 + n / 90, 0.5, 0.95) });
    }
  }
  const boards = [];
  if (n >= 5) {
    const count = Math.min(3, 1 + Math.floor((n - 5) / 10));
    for (let i = 0; i < count; i++) boards.push({ s: 0.22 + rand() * 0.36, z: -36 - i * 32, wobble: rand() * 4 });
  }

  const ids = locations.map((l) => l.id);
  let locationId = "teahupoo";
  if (n >= 6) locationId = ids[Math.floor(rand() * ids.length)];
  const playedId = locationById[locationId].realized ? locationId : "teahupoo";

  const namePool = shuffle(FIRST, rand).slice(0, 15).map((f, i) => `${f} ${LAST[(i * 3 + n) % LAST.length]}`);
  const rivals = namePool.map((name) => ({
    name,
    skill: clamp(0.16 + diff * 0.74 + (rand() - 0.5) * 0.1 + (champ ? 0.06 : 0), 0.1, 0.97),
    isPlayer: false,
  }));

  return {
    n,
    diff,
    feet,
    ...wave,
    wind,
    windName,
    tide,
    look,
    special,
    champ,
    sharks,
    reef,
    zones,
    boards,
    locationId,
    playedId,
    rivals,
  };
}

export function specialLabel(special) {
  if (special === "championship") return "Championship — heavier swell, sharper field";
  if (special === "spit-double") return "Spit counts double";
  if (special === "priority-strict") return "Strict priority — interference zeros the wave";
  return "Standard heat";
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
  if (cond.special === "spit-double") spit *= 2;
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
  for (let i = 0; i < 3; i++) {
    if (rand() < 0.1) continue;
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

export function createBracket(tour) {
  const rand = mulberry32(tour.n * 7919 + 3);
  const rivals = tour.rivals.map((r) => surfer(r.name, r.skill, false));
  const slot = Math.floor(rand() * 16);
  const field = [];
  let ri = 0;
  for (let i = 0; i < 16; i++) {
    if (i === slot) field.push(surfer("You", 0.55, true));
    else field.push(rivals[ri++]);
  }
  const rounds = [makeRound(field, "Round of 16", tour, rand, true)];
  return { rounds, roundIndex: 0, randSeed: tour.n * 7919 + 3 };
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
