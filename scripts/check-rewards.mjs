// Reward simulation and gear checks (milestone 4). No browser.
//   node scripts/check-rewards.mjs [--quiet]
// Plays 20 seasons through the real settleFinish() at a fixed finish distribution (retrying failed events, switching body every
// third season) and asserts: gear keeps arriving every season, every piece is the tier the table gave, no piece is for the
// other body, earned gear never carries a premium-only trait, ids are unique, and every piece can be worn on its body.
// Then it runs the supply out on purpose to show generated palettes take over. Prints the tables it asserts on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSurfer } from "../src/surfer.js";
import { catalog, defaultSave, grantReward, itemMap, settleFinish, switchBody } from "../src/save.js";
import { mulberry32 } from "../src/competition.js";
import { SEASON_LENGTH, TIERS } from "../src/season.js";
import { proceduralPalette, tableColours } from "../src/gear.js";

const quiet = process.argv.includes("--quiet");
const log = (...a) => {
  if (!quiet) console.log(...a);
};
const tune = JSON.parse(readFileSync(new URL("../src/data/tour.json", import.meta.url), "utf8"));
let checks = 0;
function ok(label, fn) {
  fn();
  checks++;
  console.log(`ok   ${label}`);
}

// ---- 20 seasons ----------------------------------------------------------------------------------------------------
// The distribution of finishes for the whole run: 15% win, 15% runner-up, 25% lose the semifinal, 25% lose the quarterfinal,
// 20% out in the round of 16. So 55% of attempts finish in the top 4.
const DIST = [[1, 0.15], [2, 0.15], [4, 0.25], [8, 0.25], [16, 0.2]];
const SEASONS = 20;
const rand = mulberry32(20261021);
const pickPlace = () => {
  let r = rand();
  for (const [place, p] of DIST) {
    if ((r -= p) < 0) return place;
  }
  return 16;
};

const save = defaultSave();
const grants = [];
const kits = []; // the second piece of a male kit (board shorts and board in one pattern and colour pair), granted with a win
const perSeason = new Map();
let attempts = 0;
let pityPaid = 0;
const placeCount = new Map();
while (save.season <= SEASONS) {
  if (attempts > 5000) assert.fail("the run did not finish 20 seasons in 5000 attempts");
  if (save.event === 1 && save.attempt === 0 && save.season % 3 === 0) switchBody(save, save.loadout.body === "male" ? "female" : "male");
  const body = save.loadout.body;
  const season = save.season;
  const event = save.event;
  const place = pickPlace();
  placeCount.set(place, (placeCount.get(place) || 0) + 1);
  const r = settleFinish(save, place);
  attempts++;
  assert.equal(r.season, season);
  assert.equal(r.event, event);
  if (r.pityGuarantee) pityPaid++;
  if (r.gear) grants.push({ season, event, place, body, tier: r.tier, item: r.gear, pity: r.pityGuarantee });
  if (r.kit) kits.push({ season, event, place, body, tier: r.tier, item: r.kit, main: r.gear });
  const row = perSeason.get(season) || { attempts: 0, advanced: 0, gear: 0, common: 0, rare: 0, epic: 0 };
  row.attempts++;
  if (r.advanced) row.advanced++;
  if (r.gear) {
    row.gear++;
    row[r.tier]++;
  }
  perSeason.set(season, row);
}

log(`\n20 seasons at a fixed finish distribution (win 15%, 2nd 15%, 3rd-4th 25%, 5th-8th 25%, out in the round of 16 20%), ${attempts} attempts:`);
log("season  attempts  advanced  gear  common rare epic");
for (const [s, row] of perSeason) log(`${String(s).padStart(4)}    ${String(row.attempts).padStart(6)}    ${String(row.advanced).padStart(6)}  ${String(row.gear).padStart(5)}  ${String(row.common).padStart(5)} ${String(row.rare).padStart(5)} ${String(row.epic).padStart(5)}`);
const byTier = (t) => grants.filter((g) => g.tier === t).length;
const bySlot = new Map();
for (const g of grants) {
  const key = g.item.shape ? "board" : g.item.style;
  bySlot.set(key, (bySlot.get(key) || 0) + 1);
}
log(`gear total ${grants.length}: common ${byTier("common")}, rare ${byTier("rare")}, epic ${byTier("epic")}; authored ${grants.filter((g) => !g.item.generated).length}, generated ${grants.filter((g) => g.item.generated).length}; pity guarantees paid ${pityPaid}`);
log(`by kind: ${[...bySlot].map(([k, v]) => `${k} ${v}`).join(", ")}`);
log(`trophies ${save.trophies.length} (${save.trophies.map((t) => `S${t.season}:${t.place}`).join(" ")}); points ${save.points}; pity now ${save.pity}; final event Season ${save.season} Event ${save.event}`);

ok("the run reaches Season 21 (20 full seasons) and every season advances all ten events", () => {
  assert.equal(save.season, SEASONS + 1);
  for (const [s, row] of perSeason) assert.equal(row.advanced, SEASON_LENGTH, `season ${s}`);
});
ok("gear keeps arriving: at least one piece in every season, and at least 5 in each of the last five seasons (the old code stopped after 6 pieces ever)", () => {
  for (let s = 1; s <= SEASONS; s++) assert.ok(perSeason.get(s).gear >= 1, `season ${s} gave no gear`);
  for (let s = SEASONS - 4; s <= SEASONS; s++) assert.ok(perSeason.get(s).gear >= 5, `season ${s} gave ${perSeason.get(s).gear}`);
  assert.ok(grants.length > 6 * 10);
});
ok("every piece is the tier the finish earned; no epic before the table allows one; epic stays the scarcest", () => {
  const band = (season) => tune.rewards.bands.find((b) => season >= b.seasons[0] && season <= b.seasons[1]);
  const rank = (t) => TIERS.indexOf(t);
  for (const g of grants) {
    assert.equal(g.item.reward, g.tier, `${g.item.id}`);
    const entry = band(g.season).places[String(g.place)];
    const floor = entry.floor || null;
    const top = [floor, ...(entry.chances || []).map((c) => c.tier), g.pity ? "common" : null].filter(Boolean).sort((a, b) => rank(b) - rank(a))[0];
    assert.ok(top && rank(g.tier) <= rank(top), `season ${g.season} place ${g.place} gave ${g.tier}, the table allows at most ${top}`);
    if (floor) assert.ok(rank(g.tier) >= rank(floor), `season ${g.season} place ${g.place} gave ${g.tier}, below the floor ${floor}`);
  }
  assert.equal(grants.filter((g) => g.season === 1 && g.tier === "epic").length, 0, "no epic in season 1");
  // Rare outnumbers common over 20 seasons here because from season 5 both runner-up and win floor at rare (the proposal's
  // placeholder table); with this finish mix that is 30% of the top-4 finishes. Epic must stay the scarcest tier.
  assert.ok(byTier("epic") >= 1 && byTier("epic") < byTier("rare") && byTier("epic") < byTier("common"), `epic ${byTier("epic")} must be the scarcest of common ${byTier("common")}, rare ${byTier("rare")}`);
  assert.ok(byTier("epic") / grants.length < 0.2, "epic is under a fifth of all gear");
});
ok("finishes outside the top 4 give nothing except by chance or the pity floor", () => {
  const out = grants.filter((g) => g.place >= 8);
  for (const g of out) {
    const entry = (tune.rewards.bands.find((b) => g.season >= b.seasons[0] && g.season <= b.seasons[1])).places[String(g.place)];
    assert.ok(g.pity || (entry.chances && entry.chances.length), `season ${g.season} place ${g.place} gave ${g.item.id} with no chance and no pity`);
  }
  assert.ok(out.some((g) => g.pity), "the pity floor fired at least once in the run");
});
ok("no piece is for the other body: outfits match the body worn when won, trunks are male, bikinis are female, boards are neutral", () => {
  for (const g of grants) {
    const it = g.item;
    if (it.shape) {
      assert.equal(it.body, undefined, `${it.id}: boards are neutral`);
      assert.equal(it.shape, "short");
      continue;
    }
    assert.equal(it.body, g.body, `${it.id} was won as ${g.body}`);
    if (it.style === "trunks") assert.equal(it.body, "male");
    if (it.style === "bikini") assert.equal(it.body, "female");
    assert.ok(it.style === "trunks" || it.style === "bikini" || it.style === "rashset" || it.style === "fullsuit" || it.style === "springsuit", `${it.id}: style ${it.style}`);
    assert.ok(it.body === "female" || it.style === "trunks", `${it.id}: men wear board shorts only, but this is a men's ${it.style}`);
    if (it.style === "rashset") assert.ok(/^Women's .*Rashguard Set$/.test(it.name), it.name);
  }
  for (const k of kits) {
    assert.equal(k.body, "male", "only the male body is given kits");
    assert.ok(k.item.shape || k.item.style === "trunks", `${k.item.id}: a kit piece is board shorts or a board`);
  }
});
ok("kits: a male win may bring the matching board (or board shorts) in the same pattern and colours, sometimes and never forced; women's gear is always one matched set", () => {
  assert.ok(kits.length > 5, `only ${kits.length} kits in the run`);
  const maleGrants = grants.filter((g) => g.body === "male" && g.item.generated);
  assert.ok(kits.length < maleGrants.length, "every male win came as a kit; a kit must be optional");
  for (const k of kits) {
    const a = k.main;
    const b = k.item;
    assert.equal(b.pattern, a.pattern, `${a.id} + ${b.id}: pattern`);
    assert.equal(b.color, a.color);
    assert.equal(b.color2, a.color2);
    assert.equal(!!a.shape, !b.shape, "one piece is the board, the other the board shorts");
    assert.equal(b.reward, k.tier);
  }
  const femaleKits = kits.filter((k) => k.body !== "male");
  assert.equal(femaleKits.length, 0);
  for (const g of grants.filter((x) => x.body === "female" && x.item.generated && !x.item.shape)) {
    assert.ok(["bikini", "rashset", "fullsuit"].includes(g.item.style), g.item.id);
  }
  log(`     kits ${kits.length} of ${maleGrants.length} generated male wins (${((100 * kits.length) / maleGrants.length).toFixed(0)}%; the chance is ${tune.gear.kit.chance * 100}%)`);
});
ok("earned gear never carries a premium-only trait: earned tier, price 0, shortboards only, a basic painted pattern, no gold", () => {
  const items = itemMap();
  for (const g of grants) {
    const it = items[g.item.id];
    assert.equal(it.tier, "earned");
    assert.equal(it.price, 0);
    assert.notEqual(it.pattern, "solid", `${it.id}: earned pieces carry a pattern`);
    assert.ok(Object.keys(tune.gear.patternNames).includes(it.pattern) || !it.generated);
    if (it.shape) assert.equal(it.shape, "short");
    if (it.generated) {
      assert.notEqual(it.style, "springsuit");
      for (const c of [it.color, it.color2]) assert.ok(/^#[0-9a-f]{6}$/.test(c));
      assert.ok(!/gold/i.test(it.name), it.name);
    }
  }
  const premiumIds = [...catalog.outfits, ...catalog.boards].filter((i) => i.tier === "premium").map((i) => i.id);
  for (const id of premiumIds) assert.ok(!save.owned.includes(id), `${id} is premium and must stay locked`);
});
ok("ids are unique and every granted piece is owned exactly once", () => {
  assert.equal(new Set(save.owned).size, save.owned.length);
  for (const g of grants) assert.equal(save.owned.filter((id) => id === g.item.id).length, 1);
  for (const k of kits) assert.equal(save.owned.filter((id) => id === k.item.id).length, 1);
  assert.equal(save.gear.length, grants.filter((g) => g.item.generated).length + kits.length);
});
ok("rarity changes what the piece is: common keeps to the basic patterns and calm palettes, epic to the loud patterns", () => {
  for (const g of grants.filter((x) => x.item.generated)) {
    const spec = tune.gear.tiers[g.tier];
    const fromTable = spec.palettes.some((p) => p.c1.toLowerCase() === g.item.color && p.c2.toLowerCase() === g.item.color2);
    assert.ok(spec.patterns.includes(g.item.pattern), `${g.item.id}: ${g.item.pattern} is not a ${g.tier} pattern`);
    if (fromTable) continue;
    assert.ok(g.item.name.includes(" ") && /\d/.test(g.item.name), `${g.item.id} is neither a table palette nor a generated one`);
  }
  assert.ok(tune.gear.tiers.common.patterns.every((p) => !tune.gear.tiers.epic.patterns.includes(p)), "no pattern is both common and epic");
  assert.ok(!tune.gear.tiers.common.slots.includes("suit"));
});

// ---- the supply never ends -----------------------------------------------------------------------------------------
ok("the supply never ends: 400 commons for one body exhaust the table, then generated palettes keep every piece unique", () => {
  // the female body: men's draws can bring kits, which use up table pieces without being counted below
  const s = defaultSave();
  switchBody(s, "female");
  const tableSize = tune.gear.tiers.common.slots.length * tune.gear.tiers.common.patterns.length * tune.gear.tiers.common.palettes.length;
  const authored = [...catalog.outfits, ...catalog.boards].filter((i) => i.reward === "common" && (!i.body || i.body === "female")).length;
  const items = [];
  for (let i = 0; i < 400; i++) items.push(grantReward(s, "common", mulberry32(i + 1)));
  assert.equal(new Set(items.map((i) => i.id)).size, 400);
  assert.ok(items.every((i) => i.reward === "common" && (!i.body || i.body === "female") && i.tier === "earned"));
  const generated = items.filter((i) => i.generated);
  assert.equal(generated.length, 400 - authored);
  const procedural = generated.filter((i) => !tune.gear.tiers.common.palettes.some((p) => p.c1.toLowerCase() === i.color));
  assert.ok(procedural.length > 0 && generated.length - procedural.length === tableSize, `table ${tableSize}, procedural ${procedural.length}`);
  log(`     common supply for the female body: ${authored} authored + ${tableSize} table pieces, then ${procedural.length} more from generated palettes in 400 draws, no repeats`);
  // generated palettes are deterministic and distinct
  assert.deepEqual(proceduralPalette("rare", 5), proceduralPalette("rare", 5));
  assert.equal(new Set(Array.from({ length: 500 }, (_, k) => proceduralPalette("epic", k).c1 + proceduralPalette("epic", k).name)).size, 500);
});
ok("the generated colours the renderer must hold are listed for calibration (scripts/cloth-calibrate.mjs reads them)", () => {
  const colours = tableColours();
  assert.ok(colours.length >= 40 && colours.every((c) => /^#[0-9a-f]{6}$/.test(c)));
});

// ---- wearable --------------------------------------------------------------------------------------------------
const surfer = await createSurfer({ textures: false });
ok("every generated piece from the run (both bodies, kits included) applies on its body and shows exactly its garments, all dressed alike", () => {
  const byId = itemMap();
  const visible = (rig) => ["trunks", "bikiniBottom", "bikiniTop", "rash", "fullsuit", "springsuit"].filter((n) => rig.meshes[n]?.visible).sort();
  let tried = 0;
  for (const g of [...grants, ...kits]) {
    const it = g.item;
    if (it.shape) {
      surfer.apply({ body: g.body, skin: "#c68642", bottom: g.body === "male" ? "trunks-red" : "bikini-teal", board: it.id }, byId);
      const hull = surfer.board.children[0].userData.print;
      assert.deepEqual([hull.pattern, hull.c1, hull.c2], [it.pattern, it.color, it.color2], it.id);
      tried++;
      continue;
    }
    surfer.apply({ body: it.body, skin: "#c68642", bottom: it.id, board: "board-blue" }, byId);
    const want = { trunks: ["trunks"], bikini: ["bikiniBottom", "bikiniTop"], fullsuit: ["fullsuit"], rashset: ["bikiniBottom", "rash"] }[it.style];
    assert.ok(want, `${it.id}: style ${it.style}`);
    assert.deepEqual(visible(surfer.active), want.slice().sort(), it.id);
    // one outfit is one pattern and one colour pair: every garment it shows is dressed with the item's own
    for (const name of want) {
      const worn = surfer.active.meshes[name].userData.print;
      assert.deepEqual([worn.pattern, worn.c1, worn.c2], [it.pattern, it.color, it.color2 || it.color], `${it.id}: ${name} does not match the item`);
    }
    tried++;
  }
  assert.ok(tried >= 60);
  assert.throws(() => surfer.apply({ body: "male", skin: "#c68642", bottom: grants.find((g) => g.item.style === "rashset")?.item.id ?? "rash-white-f", board: "board-blue" }, byId), /made for the female body/);
  assert.throws(() => surfer.apply({ body: "female", skin: "#c68642", bottom: "bikini-teal", top: "rash-white-f", board: "board-blue" }, byId), /no separate tops/);
});

console.log(`reward checks passed (${checks} groups)`);
