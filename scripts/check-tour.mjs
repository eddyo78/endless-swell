// Offline check of the tournament structure (milestone 4). No browser.
//   node scripts/check-tour.mjs [--quiet]
// Prints the difficulty dials for events 1-300 (30 seasons) and asserts the structure Ed decided on (decisions.md, 2026-10-21):
//   - sawtooth: every season starts below the previous season's peak, and its start and its peak are a little higher than the last
//   - a cap that is never exceeded, approached from below, with no plateau (no 100 consecutive events identical in every dial)
//   - hazards ramp over seasons 1-3 and then stay; from season 4 one rule twist per season, at most two active at once
//   - a seeded location calendar per season: honest about locked stops, a different order each season, beachbreak free
//   - the two ride rules the twists add (side-shore push, dry reef) do change a ride
// Then prints the win-odds table (INFERENCE: the proposal's player model, not measured play) for the design target.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeTwists, aiHeatTotal, createBracket, eventDials, generateTour, judgeWave, locationById, mulberry32, seasonCalendar, seasonTwist, stopStatus, warmupFor } from "../src/competition.js";
import { autopilot, createRide, resetRide, updateRide } from "../src/ride.js";
import { SEASON_LENGTH, eventNumber, seasonEvent } from "../src/season.js";

const quiet = process.argv.includes("--quiet");
const tune = JSON.parse(readFileSync(new URL("../src/data/tour.json", import.meta.url), "utf8"));
const locations = JSON.parse(readFileSync(new URL("../src/data/locations.json", import.meta.url), "utf8"));
const SEASONS = 30;
const EVENTS = SEASONS * SEASON_LENGTH;
const CAP_SKILL = tune.curve.skill.rivalCap;
const CAP_FEET = tune.curve.feet.hardCap;

let checks = 0;
function ok(label, fn) {
  fn();
  checks++;
  console.log(`ok   ${label}`);
}
const log = (...a) => {
  if (!quiet) console.log(...a);
};

const tours = [];
for (let n = 1; n <= EVENTS; n++) tours.push(generateTour(n));
const at = (season, event) => tours[eventNumber(season, event) - 1];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const rivalMean = (t) => mean(t.rivals.map((r) => r.skill));

// ---- the printout --------------------------------------------------------------------------------------------------
log("\nDifficulty for events 1-300. skill = rivals' base skill (the mean of the 15 rivals is within 0.01), ft = swell.");
log("season  start skill/ft   peak(ev9) skill/ft   finale skill/ft   hazards at ev9 (shark/reef/closeout/loose)  season twist       premium stops");
for (let s = 1; s <= SEASONS; s++) {
  const a = at(s, 1);
  const p = at(s, 9);
  const f = at(s, 10);
  const cal = seasonCalendar(s);
  const prem = cal.map((id, i) => (locationById[id].tier === "premium" ? `${i + 1}:${id}` : null)).filter(Boolean).join(" ");
  log(
    `${String(s).padStart(3)}     ${a.skill.toFixed(3)}/${a.feet.toFixed(1).padStart(4)}      ${p.skill.toFixed(3)}/${p.feet.toFixed(1).padStart(4)}          ${f.skill.toFixed(3)}/${f.feet.toFixed(1).padStart(4)}` +
      `          ${p.sharks.length}/${p.reef.length}/${p.zones.length}/${p.boards.length}                                       ${(seasonTwist(s) || "-").padEnd(16)}  ${prem}`,
  );
}

// ---- the sawtooth and the cap --------------------------------------------------------------------------------------
const peak = (s) => Math.max(...Array.from({ length: SEASON_LENGTH }, (_, i) => at(s, i + 1).skill));
const peakFeet = (s) => Math.max(...Array.from({ length: SEASON_LENGTH }, (_, i) => at(s, i + 1).feet));
ok("every season starts below the previous season's peak (rival skill and swell), events 1-300", () => {
  for (let s = 2; s <= SEASONS; s++) {
    assert.ok(at(s, 1).skill < peak(s - 1), `season ${s} start skill ${at(s, 1).skill} is not below season ${s - 1} peak ${peak(s - 1)}`);
    assert.ok(at(s, 1).feet < peakFeet(s - 1), `season ${s} start swell ${at(s, 1).feet} is not below season ${s - 1} peak ${peakFeet(s - 1)}`);
  }
});
ok("each season's start and peak are higher than the last season's (skill strictly, swell never lower)", () => {
  for (let s = 2; s <= SEASONS; s++) {
    assert.ok(at(s, 1).skill > at(s - 1, 1).skill, `start skill, season ${s}`);
    assert.ok(peak(s) > peak(s - 1), `peak skill, season ${s}`);
    assert.ok(at(s, 1).feet >= at(s - 1, 1).feet, `start swell, season ${s}`);
    assert.ok(peakFeet(s) >= peakFeet(s - 1), `peak swell, season ${s}`);
  }
  for (let s = 2; s <= 12; s++) assert.ok(at(s, 1).feet > at(s - 1, 1).feet, `swell start rises visibly through season 12 (season ${s})`);
});
ok("inside a season the climb rises over events 1-9 and the Finale is a modest bump, not a wall", () => {
  for (let s = 1; s <= SEASONS; s++) {
    for (let e = 2; e <= 9; e++) assert.ok(at(s, e).skill > at(s, e - 1).skill, `season ${s} event ${e}`);
    const bump = at(s, 10).skill - at(s, 9).skill;
    assert.ok(bump > 0 && bump <= tune.curve.skill.finaleBump + 1e-9, `season ${s} finale bump ${bump}`);
    assert.ok(at(s, 10).feet - at(s, 9).feet <= tune.curve.feet.finaleBump + 0.101, `season ${s} finale swell bump`);
    const stepAvg = (at(s, 9).skill - at(s, 1).skill) / 8;
    assert.ok(bump <= stepAvg * 1.6 + 1e-9 || s > 8, `season ${s}: the finale bump ${bump.toFixed(3)} is bigger than a normal step ${stepAvg.toFixed(3)}`);
  }
});
ok(`the cap is never exceeded: every rival's skill <= ${CAP_SKILL}, every swell <= ${CAP_FEET} ft, in all ${EVENTS} events`, () => {
  let maxSkill = 0;
  let maxFeet = 0;
  for (const t of tours) {
    for (const r of t.rivals) maxSkill = Math.max(maxSkill, r.skill);
    maxFeet = Math.max(maxFeet, t.feet);
    assert.ok(t.skill <= CAP_SKILL, `event ${t.n} base skill ${t.skill}`);
  }
  assert.ok(maxSkill <= CAP_SKILL && maxFeet <= CAP_FEET, `max ${maxSkill} / ${maxFeet}`);
  log(`     max rival skill ${maxSkill.toFixed(3)}, max base skill ${Math.max(...tours.map((t) => t.skill)).toFixed(3)}, max swell ${maxFeet} ft`);
});
ok("the curve approaches its cap from below: the Finale's base skill never reaches it and the gap keeps closing", () => {
  let prev = Infinity;
  for (let s = 1; s <= SEASONS; s++) {
    const gap = CAP_SKILL - at(s, 10).skill;
    assert.ok(gap > 0 && gap < prev, `season ${s} gap ${gap}`);
    prev = gap;
  }
  assert.ok(CAP_SKILL - at(SEASONS, 10).skill < 0.04, "season 30 Finale is within 0.04 of the cap");
});
ok("no plateau: no 100 consecutive events are identical in every dial", () => {
  const dial = (t) => JSON.stringify([+t.skill.toFixed(3), t.feet, t.sharks.length, t.reef.length, t.zones.length, t.boards.length, t.twists, t.waveCap, t.heatSeconds, t.windPush]);
  const dials = tours.map(dial);
  for (let i = 0; i + 100 <= dials.length; i++) {
    assert.ok(new Set(dials.slice(i, i + 100)).size > 1, `events ${i + 1}-${i + 100} are identical`);
  }
  for (let i = 1; i < dials.length; i++) assert.notEqual(dials[i], dials[i - 1], `events ${i} and ${i + 1} have identical dials`);
  const distinct = new Set(dials).size;
  assert.ok(distinct >= 280, `only ${distinct} distinct dial sets in ${EVENTS} events`);
  log(`     ${distinct} distinct dial sets in ${EVENTS} events`);
});

// ---- hazards and twists --------------------------------------------------------------------------------------------
const baseReef = (t) => t.reef.length - (t.twists.includes("dry-reef") ? tune.twists.defs["dry-reef"].extraReef : 0);
const hazardCounts = (t) => [t.sharks.length, baseReef(t), t.zones.length, t.boards.length];
ok("hazards ramp over seasons 1-3 (never fewer than the event before) and then stay at the season-3 Finale level", () => {
  const ramp = tune.hazards.rampSeasons * SEASON_LENGTH;
  for (let n = 2; n <= ramp; n++) hazardCounts(tours[n - 1]).forEach((c, i) => assert.ok(c >= hazardCounts(tours[n - 2])[i], `event ${n} hazard ${i}`));
  const end = hazardCounts(tours[ramp - 1]);
  for (let n = ramp; n <= EVENTS; n++) assert.deepEqual(hazardCounts(tours[n - 1]), end, `event ${n}`);
  assert.ok(end[0] === 4 && end[1] === 2 && end[2] >= 3 && end[3] >= 3, `final level ${end}`);
  log(`     hazard level from season ${tune.hazards.rampSeasons + 1} on: ${end[0]} sharks, ${end[1]} reef, ${end[2]} closeouts, ${end[3]} loose boards`);
});
ok("seasons 1-3 carry only the fixed specials (event 5 spit-double, event 8 strict priority)", () => {
  for (let s = 1; s < tune.twists.seasonTwistFrom; s++) {
    for (let e = 1; e <= SEASON_LENGTH; e++) {
      const want = e === 5 ? ["spit-double"] : e === 8 ? ["priority-strict"] : [];
      assert.deepEqual(at(s, e).twists, want, `season ${s} event ${e}`);
    }
  }
});
ok("from season 4 each season carries exactly one season twist, every event, and never more than two twists are on", () => {
  for (let s = tune.twists.seasonTwistFrom; s <= SEASONS; s++) {
    const twist = seasonTwist(s);
    assert.ok(tune.twists.defs[twist], `season ${s} twist ${twist}`);
    for (let e = 1; e <= SEASON_LENGTH; e++) {
      const t = at(s, e);
      assert.ok(t.twists.includes(twist), `season ${s} event ${e} lacks ${twist}`);
      assert.ok(t.twists.length <= tune.twists.maxActive, `season ${s} event ${e}: ${t.twists}`);
      assert.deepEqual(t.twists, activeTwists(s, e));
    }
    assert.ok(at(s, 5).twists.includes("spit-double") && at(s, 8).twists.includes("priority-strict"));
    assert.deepEqual(at(s, 10).twists, [twist], "the Finale carries the season twist only");
  }
  for (let block = 0; block * 6 + 6 <= SEASONS - 3; block++) {
    const seen = new Set(Array.from({ length: 6 }, (_, i) => seasonTwist(4 + block * 6 + i)));
    assert.equal(seen.size, 6, `block ${block}: all six twists once`);
  }
  assert.ok(Object.keys(tune.twists.defs).length >= 5, "at least the two old twists and three new ones");
});
ok("each new twist changes play: wave cap, heat length, side-shore push, dry reef; spit-double changes the score", () => {
  const find = (id) => tours.find((t) => t.twists.includes(id));
  assert.equal(find("two-wave-set").waveCap, 2);
  assert.equal(find("short-heat").heatSeconds, 30);
  const wind = find("sideshore-wind");
  assert.ok(wind.windPush < 0 && wind.windName === "sideshore");
  const dry = find("dry-reef");
  assert.ok(dry.reefLift > 0 && dry.reef.length === baseReef(dry) + 1);
  const plain = tours.find((t) => t.twists.length === 0 && t.n > 30);
  assert.equal(plain, undefined, "from season 4 no event is without a twist");
  const stats = { samples: 100, speedSum: 1000, speedSq: 10200, maxSpeed: 12, sSum: 50, tubeTime: 4, deepTime: 2, committed: 3, pumps: 3, goodPumps: 3, turns: 3, stalls: 1, clean: true, spit: true, wipe: false };
  const normal = judgeWave(stats, { feet: 8, twists: [] });
  const doubled = judgeWave(stats, { feet: 8, twists: ["spit-double"] });
  assert.equal(doubled.parts.spit, normal.parts.spit * 2);
  assert.ok(doubled.total > normal.total);
  assert.ok(tours.every((t) => t.twists.every((id) => id in tune.twists.defs)));
});
ok("the random wind never names itself sideshore unless the twist makes it matter", () => {
  for (const t of tours) assert.equal(t.windName === "sideshore", t.twists.includes("sideshore-wind"), `event ${t.n}`);
});
ok("ride rules: side-shore wind pushes the board across the face, dry reef catches a board higher up", () => {
  const cond = (extra) => ({ ...generateTour(1), sharks: [], reef: [], zones: [], boards: [], twists: [], ...extra });
  const ride = (c, steps, setup) => {
    const st = createRide();
    resetRide(st, c, { mode: "ride", z: -16 });
    if (setup) setup(st);
    for (let i = 0; i < steps; i++) updateRide(st, 1 / 60, { steer: 0, thr: 0 }, c);
    return st;
  };
  const calm = ride(cond({}), 20);
  const up = ride(cond({ windPush: 0.9 }), 20);
  const down = ride(cond({ windPush: -1.2 }), 20);
  assert.ok(up.s > calm.s + 0.01, `a push toward the wall lifts the board: s ${up.s} vs ${calm.s}`);
  assert.ok(down.s < calm.s - 0.01, `a push toward the trough drops the board: s ${down.s} vs ${calm.s}`);
  // and it costs score for a rider who corrects it: the autopilot rides a hazard-free wave with and without the twist
  for (const n of [9, 30, 99]) {
    const score = (windPush) => {
      const c = cond({ ...generateTour(n), windPush, sharks: [], reef: [], zones: [], boards: [], twists: [] });
      const st = createRide();
      resetRide(st, c, { mode: "ride", z: -16, maxRide: 16 });
      for (let i = 0; i < 60 * 20 && !st.ended; i++) updateRide(st, 1 / 60, autopilot(st, c), c);
      return judgeWave(st.stats, c).total;
    };
    const windy = score(tune.twists.defs["sideshore-wind"].windPush);
    assert.ok(windy <= score(0) - 0.4, `event ${n}: the side-shore wind should cost the autopilot score (${windy} vs ${score(0)})`);
  }
  const reef = [{ z0: -2, z1: -400 }];
  const hold = (c) => {
    const st = createRide();
    resetRide(st, c, { mode: "ride", z: -16 });
    for (let i = 0; i < 40; i++) {
      st.s = 0.22;
      st.vs = 0;
      updateRide(st, 1 / 60, { steer: 0, thr: 0 }, c);
      if (st.mode === "wipe") return st;
    }
    return st;
  };
  assert.notEqual(hold(cond({ reef, tide: "mid" })).mode, "wipe", "s = 0.22 is safe on a normal reef");
  const dry2 = hold(cond({ reef, tide: "mid", reefLift: 0.09 }));
  assert.equal(dry2.mode, "wipe");
  assert.match(dry2.wipeMsg, /Reef/);
});

// ---- the calendar --------------------------------------------------------------------------------------------------
ok("the calendar: seeded per season, stable, ten stops, the home break opens it and is the Finale, two premium stops in the middle", () => {
  const prev = JSON.stringify(seasonCalendar(1));
  for (let s = 1; s <= SEASONS; s++) {
    const cal = seasonCalendar(s);
    assert.deepEqual(cal, seasonCalendar(s), "same season, same calendar");
    assert.equal(cal.length, SEASON_LENGTH);
    assert.equal(cal[0], tune.calendar.home);
    assert.equal(cal[SEASON_LENGTH - 1], tune.calendar.home);
    const prem = cal.map((id, i) => (locationById[id].tier === "premium" ? i + 1 : 0)).filter(Boolean);
    assert.equal(prem.length, tune.calendar.premiumStops, `season ${s}`);
    assert.ok(prem.every((e) => e >= tune.calendar.premiumFrom && e <= tune.calendar.premiumTo), `season ${s}: ${prem}`);
    assert.ok(prem.every((e, i) => i === 0 || e - prem[i - 1] > 1), `season ${s}: premium stops are adjacent`);
    assert.equal(new Set(cal.filter((id) => locationById[id].tier === "premium")).size, tune.calendar.premiumStops, "two different premium breaks");
  }
  assert.equal(prev, JSON.stringify(seasonCalendar(1)));
});
ok("every season is a different order from the last (locations reordered), over 30 seasons", () => {
  for (let s = 2; s <= SEASONS; s++) assert.notDeepEqual(seasonCalendar(s), seasonCalendar(s - 1), `season ${s}`);
  assert.equal(new Set(Array.from({ length: SEASONS }, (_, i) => seasonCalendar(i + 1).join())).size, SEASONS, "30 different calendars");
});
ok("locked and unbuilt stops are honest: the tour keeps the called break, plays a built free break, and the status says which", () => {
  const sawLocked = new Set();
  const sawSoon = new Set();
  for (const t of tours) {
    const called = locationById[t.locationId];
    const played = locationById[t.playedId];
    assert.equal(called.id, seasonCalendar(t.season)[t.event - 1]);
    assert.ok(played.realized && played.tier !== "premium", `event ${t.n} is played on ${played.id}`);
    const status = stopStatus(called);
    if (status === "open") assert.equal(t.playedId, t.locationId);
    else assert.equal(t.playedId, tune.calendar.home);
    if (status === "locked") sawLocked.add(called.id);
    if (status === "soon") sawSoon.add(called.id);
  }
  assert.deepEqual([...sawLocked].sort(), locations.filter((l) => l.tier === "premium").map((l) => l.id).sort(), "all three premium breaks show as locked");
  assert.deepEqual([...sawSoon], ["beachbreak"]);
});
ok("beachbreak is free in the data (Ed, 2026-10-21): tier earned, price 0, owned by default; the other breaks stay premium", () => {
  const b = locations.find((l) => l.id === "beachbreak");
  assert.equal(b.tier, "earned");
  assert.equal(b.price, 0);
  assert.equal(b.ownedDefault, true);
  assert.equal(b.realized, false, "it is not built yet");
  for (const id of ["pipeline", "jbay", "nazare"]) assert.equal(locations.find((l) => l.id === id).tier, "premium");
});

// ---- seeds ---------------------------------------------------------------------------------------------------------
ok("deterministic, and the season is in the seed: the same event of another season has other rivals, hazards and weather", () => {
  for (const n of [1, 7, 10, 35, 100, 299]) assert.deepEqual(generateTour(n), generateTour(n));
  const namesOf = (t) => t.rivals.map((r) => r.name).join();
  for (let e = 1; e <= SEASON_LENGTH; e++) {
    assert.notEqual(namesOf(at(1, e)), namesOf(at(2, e)), `event ${e}: same rivals in seasons 1 and 2`);
    assert.notEqual(namesOf(at(2, e)), namesOf(at(3, e)));
  }
  assert.deepEqual(seasonEvent(eventNumber(7, 4)), { season: 7, event: 4 });
  assert.throws(() => generateTour(0), /integer >= 1/);
  assert.throws(() => eventNumber(1, 11), /event must be/);
});
ok("eventDials is the curve generateTour reads (no second copy of the numbers)", () => {
  for (const [s, e] of [[1, 1], [3, 9], [12, 10]]) {
    const d = eventDials(s, e);
    assert.equal(at(s, e).skill, d.skill);
    assert.equal(at(s, e).feet, Math.round(d.feet * 10) / 10);
  }
});

ok("a retry keeps the event but re-draws the bracket: same swell, hazards, break and rivals, different opponents and results", () => {
  for (const n of [4, 9, 10, 57]) {
    const tour = generateTour(n);
    const opponents = new Set();
    const firstHeats = new Set();
    for (let attempt = 0; attempt < 6; attempt++) {
      const again = generateTour(n);
      assert.deepEqual(again, tour, "the event itself does not change between attempts");
      const bracket = createBracket(tour, attempt);
      assert.deepEqual(createBracket(tour, attempt).rounds[0].heats.map((h) => [h.a.name, h.b.name, h.winner?.name]), bracket.rounds[0].heats.map((h) => [h.a.name, h.b.name, h.winner?.name]), "same attempt, same draw");
      const heat = bracket.rounds[0].heats.find((h) => h.player);
      opponents.add((heat.a.isPlayer ? heat.b : heat.a).name);
      firstHeats.add(JSON.stringify(bracket.rounds[0].heats.map((h) => h.winner?.name)));
      assert.equal(bracket.attempt, attempt);
    }
    assert.ok(opponents.size >= 3, `event ${n}: only ${opponents.size} different first opponents in 6 attempts`);
    assert.ok(firstHeats.size >= 4, `event ${n}: the other heats resolve the same way on retry`);
    assert.equal(createBracket(tour).attempt, 0);
  }
});

// ---- win odds against the design target ----------------------------------------------------------------------------
// INFERENCE: the player model is the proposal's (section 2 and 8): a wave averages `avg` with spread 1.3, 12% of waves are
// wipeouts (0.4-2.0), a heat is the best two of the waves the event allows. Rivals are the game's own aiHeatTotal. Real player
// scores are not measured yet (milestone 2 is open), so these are design targets, not results. top-4 = two heat wins in a row.
function heatWinProb(tour, avg, runs, seed) {
  const rand = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    const rival = tour.rivals[i % tour.rivals.length];
    const waves = [];
    for (let w = 0; w < tour.waveCap; w++) waves.push(rand() < 0.12 ? 0.4 + rand() * 1.6 : Math.max(0.1, Math.min(10, avg + gauss() * 1.3)));
    waves.sort((a, b) => b - a);
    const you = (waves[0] || 0) + (waves[1] || 0);
    const them = aiHeatTotal(rival.skill, tour, rand).total;
    if (you > them || (you === them && rand() < 0.5)) wins++;
  }
  return wins / runs;
}
const ROWS = [[1, 1], [1, 5], [1, 9], [1, 10], [2, 1], [3, 9], [4, 1], [5, 9], [10, 1], [10, 9], [10, 10], [20, 9], [30, 1], [30, 9], [30, 10]];
const odds = new Map();
log("\nWin odds, INFERENCE (proposal player model). p = chance to win one heat, top 4 = p squared, event win = p^4.");
log("event            rival skill  swell   avg 6: p / top4      avg 7: p / top4 / win     avg 8: p / top4 / win     avg 9: p / top4 / win");
for (const [s, e] of ROWS) {
  const t = at(s, e);
  const row = [6, 7, 8, 9].map((avg) => {
    const p = heatWinProb(t, avg, 6000, 1000 + s * 31 + e);
    odds.set(`${s}.${e}.${avg}`, p);
    return p;
  });
  const cell = (p, win) => `${p.toFixed(2)} / ${(p * p).toFixed(2)}${win ? ` / ${(p ** 4).toFixed(2)}` : ""}`;
  log(
    `S${String(s).padStart(2)} E${String(e).padStart(2)} ${t.twists.length ? "(" + t.twists.join("+") + ")" : ""}`.padEnd(34) +
      `${rivalMean(t).toFixed(3)}       ${t.feet.toFixed(1).padStart(4)}   ${cell(row[0], false).padEnd(20)} ${cell(row[1], true).padEnd(25)} ${cell(row[2], true).padEnd(25)} ${cell(row[3], true)}`,
  );
}
ok("design target: a skilled player (avg 8) clears the top 4 about half the time or better at the Season 30 Finale, and the first events are easy for a 7", () => {
  const top4 = (s, e, avg) => odds.get(`${s}.${e}.${avg}`) ** 2;
  assert.ok(top4(30, 10, 8) >= 0.4 && top4(30, 10, 8) <= 0.75, `avg 8 at the cap: ${top4(30, 10, 8)}`);
  assert.ok(top4(30, 10, 9) >= 0.6, `avg 9 at the cap: ${top4(30, 10, 9)}`);
  assert.ok(top4(30, 10, 6) <= 0.35, `avg 6 at the cap should struggle: ${top4(30, 10, 6)}`);
  assert.ok(top4(1, 1, 7) >= 0.9, `avg 7, season 1 event 1: ${top4(1, 1, 7)}`);
  assert.ok(top4(30, 1, 8) > top4(30, 10, 8), "the season start is easier than its Finale");
  assert.ok(top4(3, 9, 8) > top4(30, 9, 8), "the late seasons are harder than the early ones");
});

// ---- the Season 1 warm-up ------------------------------------------------------------------------------------------
// Rival two-wave totals are measured with the game's own aiHeatTotal over every rival of the event (400 heats each). "Before"
// is the same event with the warm-up scale off. The rider model is real ride.js + judgeWave (the ride is simulated at 60 Hz),
// driven by a seeded bad rider: INFERENCE, not a human; real pass rates come back only with the play log (Shift+L).
function rivalTotals(tour, seed) {
  const rand = mulberry32(seed);
  const xs = [];
  for (let k = 0; k < 400; k++) for (const r of tour.rivals) xs.push(aiHeatTotal(r.skill, tour, rand).total);
  xs.sort((a, b) => a - b);
  const q = (p) => xs[Math.floor(p * (xs.length - 1))];
  return { mean: mean(xs), p10: q(0.1), p90: q(0.9) };
}
const warm = Array.from({ length: SEASON_LENGTH }, (_, i) => {
  const t = at(1, i + 1);
  return { after: rivalTotals(t, 50 + i), before: rivalTotals({ ...t, rivalScale: 1 }, 50 + i) };
});
log("\nSeason 1 rival two-wave totals (the best two of the rival's waves; mean / 10th / 90th percentile), before and after the warm-up.");
for (let i = 0; i < SEASON_LENGTH; i++) {
  const f = (r) => `${r.mean.toFixed(2)} / ${r.p10.toFixed(1)} / ${r.p90.toFixed(1)}`;
  log(`Event ${String(i + 1).padStart(2)}   before ${f(warm[i].before).padEnd(20)} after ${f(warm[i].after).padEnd(20)} scale ${warmupFor(1, i + 1).rivalScale}`);
}
ok("warm-up: the rival scale and the wipeout forgiveness apply to Season 1 only, the scale reaches 1 by Event 5, and every later event is the ordinary curve", () => {
  const ev = tune.warmup.rivalScale.length;
  assert.ok(ev <= 4 && warmupFor(1, ev + 1).rivalScale === 1, "the ordinary curve takes over by Event 5");
  for (let e = 1; e < ev; e++) assert.ok(warmupFor(1, e).rivalScale < warmupFor(1, e + 1).rivalScale, `the scale rises from event ${e} to ${e + 1}`);
  assert.ok(warmupFor(1, 1).rivalScale < 1);
  for (const t of tours) {
    const warmEvent = t.season === tune.warmup.season && t.event <= ev;
    assert.equal(t.rivalScale < 1, warmEvent, `event ${t.n} rival scale ${t.rivalScale}`);
    assert.equal(!!t.forgiveWipe, t.season === tune.warmup.season && t.event <= tune.warmup.forgiveEvents, `event ${t.n} forgiveness`);
  }
  assert.deepEqual({ ...at(1, 5), rivalScale: 1 }, at(1, 5));
  // the dials the sawtooth sets are untouched: the warm-up changes only what the rivals score and how a first wipeout counts
  assert.equal(at(1, 1).skill, eventDials(1, 1).skill);
});
ok("warm-up: rival two-wave totals rise from Event 1 to Event 5 with no jump, and from Event 5 are exactly what they were before", () => {
  assert.ok(warm[0].after.mean <= 3.5, `Event 1 rival mean ${warm[0].after.mean}`);
  assert.ok(warm[0].after.p90 <= 4.5, `Event 1 rival 90th percentile ${warm[0].after.p90}`);
  for (let i = 1; i < 5; i++) {
    const step = warm[i].after.mean - warm[i - 1].after.mean;
    assert.ok(step > 0 && step <= 2.5, `Event ${i} to ${i + 1}: step ${step.toFixed(2)}`);
  }
  for (let i = 4; i < SEASON_LENGTH; i++) assert.equal(warm[i].after.mean, warm[i].before.mean, `Event ${i + 1} is unchanged`);
  for (let i = 0; i < 4; i++) assert.ok(warm[i].after.mean < warm[i].before.mean, `Event ${i + 1} is softer than before`);
});
ok("warm-up: a forgiven wipeout scores what the ride earned (ride length, cap), an ordinary one stays capped, and a ridden wave is untouched", () => {
  const tour = at(1, 1);
  const forgive = tour.forgiveWipe;
  const wiped = (seconds, extra = {}) => ({ samples: seconds * 60, speedSum: seconds * 60 * 9, speedSq: seconds * 60 * 82, maxSpeed: 11, sSum: seconds * 60 * 0.5, tubeTime: 0, deepTime: 0, committed: 0, pumps: 3, goodPumps: 3, turns: 2, stalls: 0, clean: false, spit: false, wipe: true, ...extra });
  const plain = judgeWave(wiped(8), tour);
  const kind = judgeWave(wiped(8), tour, { forgive });
  assert.equal(plain.total, 0, "an ordinary wipeout with no tube time scores nothing");
  assert.ok(kind.forgiven && kind.wipe && kind.total > 1, `a forgiven 8 s wipeout earns something: ${kind.total}`);
  assert.ok(kind.total <= forgive.cap);
  assert.ok(judgeWave(wiped(2), tour, { forgive }).total < kind.total, "a shorter ride earns less");
  assert.equal(kind.parts.exit, 0, "no exit bonus for a wipeout");
  const ridden = { ...wiped(8), wipe: false, clean: true };
  assert.deepEqual(judgeWave(ridden, tour, { forgive }), judgeWave(ridden, tour), "forgiveness never touches a wave that was ridden");
  assert.ok(judgeWave(wiped(30, { tubeTime: 12, deepTime: 8 }), tour, { forgive }).total <= forgive.cap);
});

function poorHeat(tour, rand, forgiving) {
  // three waves; each is "idle" (no input, wipes out) with chance 0.35, else steers like the autopilot and pumps for 2-6 s
  const waves = [];
  let limit = tour.waveCap;
  let forgivenUsed = false;
  for (let w = 0; w < limit; w++) {
    const idle = rand() < 0.35;
    const effort = 2 + rand() * 4;
    const st = createRide();
    resetRide(st, tour, { mode: "ride", z: -16, maxRide: 16 });
    for (let i = 0; i < 60 * 20 && !st.ended; i++) {
      const a = autopilot(st, tour);
      const thr = idle ? 0 : st.t < effort ? (Math.sin(st.t * Math.PI * 2 * 2.4) > 0 ? 1 : 0) : 0;
      updateRide(st, 1 / 60, { steer: idle ? 0 : a.steer, thr }, tour);
    }
    const useForgive = forgiving && !forgivenUsed && st.stats.wipe && tour.forgiveWipe ? tour.forgiveWipe : null;
    const judged = judgeWave(st.stats, tour, { forgive: useForgive });
    if (judged.forgiven) {
      forgivenUsed = true;
      limit += 1;
    }
    waves.push(judged.total);
  }
  waves.sort((a, b) => b - a);
  return (waves[0] || 0) + (waves[1] || 0);
}
function passModel(n, forgiving, scaled, heats) {
  const base = generateTour(n);
  const tour = forgiving && scaled ? base : { ...base, rivalScale: 1, forgiveWipe: null };
  const rand = mulberry32(900 + n);
  let wins = 0;
  for (let i = 0; i < heats; i++) {
    const you = poorHeat(tour, rand, forgiving);
    const rival = tour.rivals[i % tour.rivals.length];
    const them = aiHeatTotal(rival.skill, tour, rand).total;
    if (you > them || (you === them && rand() < 0.5)) wins++;
  }
  return wins / heats;
}
const poor = [1, 2, 3, 4].map((n) => ({ before: passModel(n, false, false, 160), after: passModel(n, true, true, 160) }));
log("\nA bad rider (35% of waves no input at all and a wipeout; the rest pump for 2-6 s), INFERENCE. p = chance to win one heat; top 4 = p squared (two heats); passed within two tries = 1 - (1 - p^2)^2.");
poor.forEach((r, i) => {
  const f = (p) => `p ${p.toFixed(2)}  top 4 ${(p * p).toFixed(2)}  within two tries ${(1 - (1 - p * p) ** 2).toFixed(2)}`;
  log(`Event ${i + 1}   before: ${f(r.before)}   after: ${f(r.after)}`);
});
ok("warm-up: a bad rider (wipes a third of the time, short pumping rides) wins an Event 1 heat at least 85% of the time and passes within two tries at least 95%, and is better off than before in Events 1-3", () => {
  const p = poor[0].after;
  assert.ok(p >= 0.85, `Event 1 heat win ${p}`);
  assert.ok(1 - (1 - p * p) ** 2 >= 0.95, `Event 1 passed within two tries ${1 - (1 - p * p) ** 2}`);
  for (let i = 0; i < 3; i++) assert.ok(poor[i].after >= poor[i].before, `Event ${i + 1}: ${poor[i].after} vs ${poor[i].before}`);
});

console.log(`tour checks passed (${checks} groups)`);
