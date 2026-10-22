// Node check for save version 2 and the finish rules (milestone 4). No browser.
//   node scripts/check-save.mjs
// Covers: a version 1 save migrates without losing owned items or the current tour (nextTour -> season/event), the version 1
// key is left alone, version 2 round-trips, bad gear recipes are dropped loudly, the top-4 gate, points and ranks, the Finale
// trophy, the pity counter, and the exact-tier fix to the old reward rule.
import assert from "node:assert/strict";
import {
  LEGACY_SAVE_KEY,
  SAVE_KEY,
  catalog,
  defaultSave,
  grantReward,
  loadSave,
  sanitize,
  settleFinish,
  switchBody,
  writeSave,
} from "../src/save.js";
import { mulberry32 } from "../src/competition.js";
import { PITY_LIMIT, SEASON_LENGTH, eventNumber, pointsFor, rankInfo, rankTitle, seasonEvent } from "../src/season.js";

let checks = 0;
function ok(label, fn) {
  fn();
  checks++;
  console.log(`ok   ${label}`);
}

// An in-memory localStorage, so loadSave/writeSave run the real code.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// A version 1 save as the shipped build wrote it (src/save.js before milestone 4): v: 1, nextTour, results of {tour, place, at}.
const V1 = {
  v: 1,
  nextTour: 23,
  results: [
    { tour: 1, place: 1, at: 1 },
    { tour: 2, place: 4, at: 2 },
    { tour: 3, place: 16, at: 3 },
    { tour: 10, place: 2, at: 4 },
    { tour: 20, place: 8, at: 5 },
    { tour: 21, place: 1, at: 6 },
  ],
  owned: ["trunks-red", "trunks-navy", "trunks-palm", "bikini-teal", "rash-white", "rash-reef", "onesie-blue", "bikini-sunset", "board-blue", "board-chevron", "board-sun", "board-stripe", "board-tiger"],
  loadout: { body: "female", skin: "#c68642", bottom: "bikini-sunset", top: "rash-reef", board: "board-tiger" },
  quality: "low",
  best: 7.4,
};

ok("a version 1 save: season/event from nextTour, every owned item that still exists kept, loadout kept", () => {
  const s = sanitize(JSON.parse(JSON.stringify(V1)));
  assert.equal(s.v, 2);
  assert.deepEqual({ season: s.season, event: s.event }, seasonEvent(23));
  assert.deepEqual({ season: s.season, event: s.event }, { season: 3, event: 3 });
  assert.equal(eventNumber(s.season, s.event), V1.nextTour);
  for (const id of ["trunks-red", "trunks-navy", "trunks-palm", "bikini-teal", "bikini-sunset", "board-blue", "board-chevron", "board-sun", "board-stripe", "board-tiger"]) assert.ok(s.owned.includes(id), `${id} lost`);
  for (const id of ["rash-white-f", "rash-reef-f", "fullsuit-blue-f"]) assert.ok(s.owned.includes(id), `${id} lost`);
  for (const id of ["rash-white-m", "rash-reef-m", "fullsuit-blue-m"]) assert.ok(!s.owned.includes(id), `${id} is a men's top or suit and must not exist`);
  assert.equal(s.loadout.body, "female");
  assert.equal(s.loadout.skin, "#c68642");
  assert.equal(s.loadout.bottom, "rash-reef-f", "a woman who wore a rashguard over her bikini now wears the matching rashguard set");
  assert.equal("top" in s.loadout, false);
  assert.equal(s.loadout.board, "board-tiger");
  assert.equal(s.quality, "low");
  assert.equal(s.best, 7.4);
  assert.equal(s.attempt, 0);
  assert.equal(s.pity, 0);
  assert.deepEqual(s.gear, []);
});
ok("a version 1 save: points rebuilt from the kept results, Finale trophies from the Finale results in them", () => {
  const s = sanitize(JSON.parse(JSON.stringify(V1)));
  const want = pointsFor(1, false) + pointsFor(4, false) + pointsFor(16, false) + pointsFor(2, true) + pointsFor(8, true) + pointsFor(1, false);
  // tour 10 and tour 20 are Season Finales (event 10 of seasons 1 and 2)
  assert.equal(s.points, want);
  assert.deepEqual(s.trophies.map((t) => [t.season, t.place]), [[1, 2]]);
  assert.equal(s.results.length, 6);
  assert.deepEqual(s.results[3], { n: 10, season: 1, event: 10, place: 2, at: 4 });
});
ok("migration is idempotent and survives JSON", () => {
  const once = sanitize(JSON.parse(JSON.stringify(V1)));
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(once))), once);
});
ok("edge saves: no nextTour -> season 1 event 1; nextTour 10 -> the Finale; nextTour 11 -> season 2 event 1; garbage -> a new save", () => {
  assert.deepEqual([sanitize({ v: 1 }).season, sanitize({ v: 1 }).event], [1, 1]);
  assert.deepEqual([sanitize({ nextTour: 10 }).season, sanitize({ nextTour: 10 }).event], [1, 10]);
  assert.deepEqual([sanitize({ nextTour: 11 }).season, sanitize({ nextTour: 11 }).event], [2, 1]);
  assert.deepEqual([sanitize({ nextTour: 1e6 + 1 }).season, sanitize({ nextTour: 1e6 + 1 }).event], [100001, 1]);
  assert.deepEqual(sanitize(null), defaultSave());
  assert.deepEqual(sanitize("nonsense"), defaultSave());
});
ok("loadSave reads the version 1 key when there is no version 2 save, and never writes or deletes the version 1 key", () => {
  store.clear();
  store.set(LEGACY_SAVE_KEY, JSON.stringify(V1));
  const s = loadSave();
  assert.equal(s.v, 2);
  assert.equal(s.season, 3);
  assert.ok(writeSave(s));
  assert.ok(store.has(SAVE_KEY));
  assert.equal(store.get(LEGACY_SAVE_KEY), JSON.stringify(V1), "the version 1 save must be untouched");
  const again = loadSave();
  assert.deepEqual(again, s, "the version 2 save wins over the version 1 key and round-trips");
});
ok("loadSave: a corrupt save is logged and replaced by a new save, never silently", () => {
  store.clear();
  store.set(SAVE_KEY, "{not json");
  const errors = [];
  const keep = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    const s = loadSave();
    assert.deepEqual(s, defaultSave());
  } finally {
    console.error = keep;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /could not be read/);
});
ok("version 2 round-trips through JSON with gear, trophies, points and pity intact", () => {
  const s = defaultSave();
  for (let i = 0; i < 25; i++) settleFinish(s, i % 3 === 0 ? 1 : i % 3 === 1 ? 4 : 16);
  assert.ok(s.gear.length >= 8 && s.trophies.length >= 1 && s.points > 0);
  const back = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);
  for (const recipe of s.gear) assert.ok(back.owned.some((id) => id.startsWith("gen:")), "generated ids are owned");
});
ok("bad gear recipes are dropped with a console warning, and a recipe can never be a premium or wrong-body piece", () => {
  const good = { slot: "board", body: null, pattern: "stripes", color: "#0f8f8a", color2: "#f4f1ea", tier: "common", name: "Reef Teal" };
  const bad = [
    { ...good, pattern: "solid" },
    { ...good, pattern: "gold-foil" },
    { ...good, color: "teal" },
    { ...good, body: "male" },
    { ...good, slot: "top", body: null },
    { ...good, slot: "top", body: "other" },
    { ...good, slot: "suit", body: "male", tier: "common" },
    { ...good, tier: "premium" },
    { ...good, slot: "fish" },
    null,
  ];
  const warnings = [];
  const keep = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  let s;
  try {
    s = sanitize({ v: 2, season: 2, event: 3, gear: [...bad, good], owned: ["gen:board:any:stripes:ffffff:000000"], loadout: { body: "male", skin: "#6e3a22", bottom: "trunks-red", top: null, board: "board-blue" } });
  } finally {
    console.warn = keep;
  }
  assert.equal(warnings.length, bad.length);
  assert.equal(s.gear.length, 1);
  assert.deepEqual(s.owned.filter((id) => id.startsWith("gen:")), ["gen:board:any:stripes:0f8f8a:f4f1ea"]);
});

// ---- the finish rules ----------------------------------------------------------------------------------------------
ok("top-4 gate: 4th or better advances and resets the attempts; 8th or 16th stays on the event and counts the attempt", () => {
  const s = defaultSave();
  assert.deepEqual(settleFinish(s, 8).next, { season: 1, event: 1 });
  assert.equal(s.attempt, 1);
  assert.equal(settleFinish(s, 16).advanced, false);
  assert.equal(s.attempt, 2);
  const r = settleFinish(s, 4);
  assert.equal(r.advanced, true);
  assert.deepEqual({ season: s.season, event: s.event, attempt: s.attempt }, { season: 1, event: 2, attempt: 0 });
  for (const place of [1, 2]) {
    const t = defaultSave();
    assert.equal(settleFinish(t, place).advanced, true);
    assert.equal(t.event, 2);
  }
});
ok("a win pays more than a top-4 finish: points by finish, the Finale pays half again, points only go up", () => {
  assert.ok(pointsFor(1, false) > pointsFor(2, false) && pointsFor(2, false) > pointsFor(4, false) && pointsFor(4, false) > pointsFor(8, false) && pointsFor(8, false) > pointsFor(16, false));
  assert.equal(pointsFor(1, true), Math.round(pointsFor(1, false) * 1.5));
  const s = defaultSave();
  let last = 0;
  for (let i = 0; i < 60; i++) {
    settleFinish(s, [16, 8, 4, 2, 1][i % 5]);
    assert.ok(s.points > last);
    last = s.points;
  }
  assert.throws(() => pointsFor(3, false), /unknown finish place 3/);
});
ok("the season rolls over after the Finale, a Finale top 4 adds a trophy, and nothing else does", () => {
  const s = defaultSave();
  for (let e = 1; e < SEASON_LENGTH; e++) {
    const r = settleFinish(s, 1);
    assert.equal(r.trophy, null);
    assert.equal(r.newSeason, false);
  }
  assert.deepEqual([s.season, s.event], [1, 10]);
  const lost = settleFinish(s, 8);
  assert.equal(lost.trophy, null);
  assert.deepEqual([s.season, s.event, s.attempt], [1, 10, 1]);
  const r = settleFinish(s, 2);
  assert.equal(r.finale, true);
  assert.equal(r.points, pointsFor(2, true));
  assert.equal(r.newSeason, true);
  assert.equal(r.trophy.season, 1);
  assert.equal(r.trophy.place, 2);
  assert.deepEqual([s.season, s.event, s.attempt], [2, 1, 0]);
  assert.equal(s.trophies.length, 1);
  assert.deepEqual(r.next, { season: 2, event: 1 });
});
ok("ranks: named steps then numbered steps forever, floors only rise, the title never repeats", () => {
  assert.equal(rankInfo(0).title, "Qualifier");
  assert.equal(rankInfo(99).title, "Qualifier");
  assert.equal(rankInfo(100).title, "Challenger");
  assert.equal(rankInfo(2400).title, "Legend");
  assert.equal(rankInfo(2400).toNext > 0, true);
  const titles = new Set();
  for (let i = 0; i < 60; i++) {
    const t = rankTitle(i);
    assert.ok(!titles.has(t), `${t} repeats`);
    titles.add(t);
  }
  assert.equal(rankTitle(7), "Legend II");
  assert.equal(rankTitle(8), "Legend III");
  assert.equal(rankTitle(11), "Legend VI");
  let p = 0;
  let index = -1;
  for (let i = 0; i < 400; i++) {
    p += 100;
    const r = rankInfo(p);
    assert.ok(r.index >= index, "rank never goes down as points go up");
    assert.ok(r.nextAt > p && r.floor <= p);
    index = r.index;
  }
  assert.ok(index >= 8, `40000 points should be deep into the numbered ranks, got index ${index}`);
});
ok("pity: five finishes without gear in a row guarantee a common on the next finish, then the count restarts", () => {
  const s = defaultSave();
  for (let i = 0; i < PITY_LIMIT; i++) {
    const r = settleFinish(s, 16);
    assert.equal(r.gear, null, `finish ${i + 1}`);
    assert.equal(s.pity, i + 1);
  }
  const r = settleFinish(s, 16);
  assert.ok(r.gear, "the sixth gearless-eligible finish must pay");
  assert.equal(r.tier, "common");
  assert.equal(r.pityGuarantee, true);
  assert.equal(r.gear.reward, "common");
  assert.equal(s.pity, 0);
  assert.equal(settleFinish(s, 16).gear, null);
  assert.equal(s.pity, 1);
  // a finish that pays on its own also resets it
  const t = defaultSave();
  settleFinish(t, 16);
  settleFinish(t, 16);
  assert.equal(t.pity, 2);
  const win = settleFinish(t, 1);
  assert.ok(win.gear);
  assert.equal(t.pity, 0);
});
ok("rarity fix: grantReward draws the exact tier (the old rule gave a common win the epic board)", () => {
  for (const body of ["male", "female"]) {
    for (const tier of ["common", "rare", "epic"]) {
      for (let seed = 1; seed <= 150; seed++) {
        const s = defaultSave();
        switchBody(s, body);
        const rand = mulberry32(seed);
        const item = grantReward(s, tier, rand);
        assert.equal(item.reward, tier, `${body} ${tier} seed ${seed} granted ${item.id} (${item.reward})`);
      }
    }
  }
  // the exact scenario: only the epic board is left unowned among authored pieces
  const s = defaultSave();
  for (const i of [...catalog.outfits, ...catalog.boards]) if (i.reward && i.reward !== "epic" && !i.body) s.owned.push(i.id);
  const item = grantReward(s, "common", mulberry32(7));
  assert.equal(item.reward, "common");
  assert.notEqual(item.id, "board-tiger");
  assert.throws(() => grantReward(s, "legendary", mulberry32(1)), /unknown tier/);
});
ok("the authored reward pieces still arrive first, then generated gear takes over", () => {
  const s = defaultSave();
  const got = [];
  for (let i = 0; i < 12; i++) got.push(grantReward(s, "common", mulberry32(i + 1)));
  const authoredCommon = catalog.outfits.concat(catalog.boards).filter((i) => i.reward === "common" && (!i.body || i.body === "male")).map((i) => i.id);
  assert.deepEqual(got.slice(0, authoredCommon.length).map((i) => i.id).sort(), authoredCommon.slice().sort());
  assert.ok(got.slice(authoredCommon.length).every((i) => i.generated));
});

console.log(`save checks passed (${checks} groups)`);
