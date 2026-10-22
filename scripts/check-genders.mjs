// Node check for "clear genders" (decisions.md, 2026-10-21): the game has a male body and a female body, outfits are
// made for exactly one of them, and nothing puts or grants an item on the wrong body. Ed, 2026-10-21 (after decisions.md):
// men wear board shorts and a board only (no shirts, no suits), and every outfit is a matching set.
//   node scripts/check-genders.mjs
// Covers the catalog data, the save rules (load, migrate, switch body, equip, rewards) and the surfer (apply() throws
// on a wrong-body item; each glb holds only its own body's garments). No browser needed.
import assert from "node:assert/strict";
import { createSurfer } from "../src/surfer.js";
import {
  bottomsFor,
  catalog,
  defaultBottom,
  defaultSave,
  equipItem,
  grantReward,
  outfitsFor,
  sanitize,
  settleFinish,
  switchBody,
} from "../src/save.js";
import { mulberry32 } from "../src/competition.js";
import { GEAR_TIERS, SKIN_CLEARANCE, deltaE, gearTables, proceduralPalette, skinDistance } from "../src/gear.js";

let checks = 0;
function ok(label, fn) {
  fn();
  checks++;
  console.log(`ok   ${label}`);
}
const throws = (fn, re) => assert.throws(fn, re);
const byId = Object.fromEntries([...catalog.bodies, ...catalog.outfits, ...catalog.boards].map((i) => [i.id, i]));

// ---- catalog data -------------------------------------------------------------------------------------------------
ok("bodies are named Male and Female", () => {
  assert.deepEqual(catalog.bodies.map((b) => [b.id, b.name]), [["male", "Male"], ["female", "Female"]]);
});
ok("every outfit item names exactly one body; boards name none", () => {
  for (const o of catalog.outfits) assert.ok(o.body === "male" || o.body === "female", `${o.id} has body ${o.body}`);
  for (const b of catalog.boards) assert.equal(b.body, undefined, `${b.id} must be neutral`);
});
ok(`no garment's main colour is within delta E ${SKIN_CLEARANCE} (CIE76, Lab D65) of any catalog skin tone: catalog items, gear tables, generated palettes`, () => {
  // the check can fail: the old gold (#e2b657) read as the light skin tone and was 13 from it
  assert.ok(skinDistance("#e2b657") < SKIN_CLEARANCE, "the measure must flag the old gold set colour");
  assert.ok(deltaE("#f1c27d", "#f1c27d") === 0);
  let measured = 0;
  const need = (what, hex) => {
    const d = skinDistance(hex);
    measured++;
    assert.ok(d >= SKIN_CLEARANCE, `${what} ${hex} is only delta E ${d.toFixed(1)} from a skin tone (needs ${SKIN_CLEARANCE})`);
  };
  for (const o of catalog.outfits) need(`catalog ${o.id}`, o.color);
  for (const tier of GEAR_TIERS) {
    for (const p of gearTables.tiers[tier].palettes) need(`table ${tier} ${p.name}`, p.c1);
    for (let k = 0; k < 400; k++) need(`generated ${tier} #${k}`, proceduralPalette(tier, k).c1);
  }
  console.log(`     ${measured} colours measured, the nearest is delta E ${Math.min(...catalog.outfits.map((o) => skinDistance(o.color))).toFixed(1)} (catalog) `);
});
ok("item ids are unique", () => {
  const ids = [...catalog.bodies, ...catalog.outfits, ...catalog.boards].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});
ok("bikinis are female only, trunks male only", () => {
  for (const o of catalog.outfits) {
    if (o.style === "bikini") assert.equal(o.body, "female", o.id);
    if (o.style === "trunks") assert.equal(o.body, "male", o.id);
  }
  assert.ok(catalog.outfits.some((o) => o.style === "bikini") && catalog.outfits.some((o) => o.style === "trunks"));
});
ok("men wear board shorts only: no men's rashguard, fullsuit or springsuit in the catalog; women's rashguard sets, fullsuits and springsuits stay", () => {
  for (const o of catalog.outfits.filter((i) => i.body === "male")) assert.equal(o.style, "trunks", `${o.id} is a men's ${o.style}; men wear board shorts only`);
  assert.ok(catalog.outfits.some((o) => o.body === "male" && o.style === "trunks"));
  for (const style of ["bikini", "rashset", "fullsuit", "springsuit"]) {
    assert.ok(catalog.outfits.some((o) => o.body === "female" && o.style === style), `no women's ${style}`);
  }
  for (const o of catalog.outfits) {
    assert.ok(!["rash", "top"].includes(o.style) && o.slot !== "top", `${o.id}: there are no separate tops`);
    if (o.body === "female") assert.ok(/^(Women's |\w+ Bikini)/.test(o.name) || o.style === "bikini", o.id);
  }
});
ok("a rashguard is always a set: a women's rashguard set item is one piece with one pattern and one colour pair", () => {
  for (const o of catalog.outfits.filter((i) => i.style === "rashset")) {
    assert.equal(o.body, "female", o.id);
    assert.ok(/Rashguard Set$/.test(o.name), o.id);
    assert.ok(o.color && o.color2 && o.pattern, o.id);
  }
});
ok("defaults: male is red trunks, female is the teal bikini, and a loadout has no top", () => {
  assert.equal(defaultBottom("male"), "trunks-red");
  assert.equal(defaultBottom("female"), "bikini-teal");
  const s = defaultSave();
  assert.equal(s.loadout.body, "male");
  assert.equal(s.loadout.bottom, "trunks-red");
  assert.equal("top" in s.loadout, false);
  for (const body of ["male", "female"]) assert.ok(byId[defaultBottom(body)].ownedDefault, `${defaultBottom(body)} must be owned by default`);
});
ok("tiers and prices kept for the women's pieces that remain: the gold rashguard set and the stealth springsuit are premium", () => {
  const premium = catalog.outfits.filter((o) => o.tier === "premium").map((o) => `${o.family}:${o.price}`).sort();
  assert.deepEqual(premium, ["rash-gold:400", "spring-stealth:500"]);
});

// ---- save rules ---------------------------------------------------------------------------------------------------
ok("a loaded save never keeps a wrong-body outfit in the loadout", () => {
  const maleBikini = sanitize({ loadout: { body: "male", skin: "#6e3a22", bottom: "bikini-teal", board: "board-blue" }, owned: ["bikini-teal"] });
  assert.equal(maleBikini.loadout.bottom, "trunks-red");
  const femaleTrunks = sanitize({ loadout: { body: "female", skin: "#6e3a22", bottom: "trunks-red", board: "board-blue" }, owned: ["trunks-red"] });
  assert.equal(femaleTrunks.loadout.bottom, "bikini-teal");
  const suitOnWrongBody = sanitize({ loadout: { body: "male", skin: "#6e3a22", bottom: "fullsuit-blue-f", board: "board-blue" }, owned: ["fullsuit-blue-f"] });
  assert.equal(suitOnWrongBody.loadout.bottom, "trunks-red");
});
ok("a save from before this rule loads cleanly: a man's top or suit is dropped (the shorts stay), a woman's rashguard becomes the matching set", () => {
  const manShirt = sanitize({ owned: ["rash-reef-m", "rash-white-m", "fullsuit-blue-m", "trunks-stripe"], loadout: { body: "male", skin: "#6e3a22", bottom: "trunks-stripe", top: "rash-reef-m", board: "board-blue" } });
  assert.equal(manShirt.loadout.bottom, "trunks-stripe");
  assert.equal("top" in manShirt.loadout, false);
  for (const id of ["rash-reef-m", "rash-white-m", "fullsuit-blue-m"]) assert.ok(!manShirt.owned.includes(id), `${id} is a men's top or suit and must be dropped`);
  assert.ok(manShirt.owned.includes("trunks-stripe"));
  const manSuit = sanitize({ owned: ["fullsuit-blue-m"], loadout: { body: "male", skin: "#6e3a22", bottom: "fullsuit-blue-m", top: null, board: "board-blue" } });
  assert.equal(manSuit.loadout.bottom, "trunks-red");
  const oldGear = [
    { slot: "top", body: "male", pattern: "stripes", color: "#0f8f8a", color2: "#f4f1ea", tier: "common", name: "Reef Teal" },
    { slot: "suit", body: "male", pattern: "palm", color: "#8fcf4a", color2: "#13261b", tier: "rare", name: "Neon Lime" },
    { slot: "top", body: "female", pattern: "chevron", color: "#e8574a", color2: "#fff1e6", tier: "common", name: "Coral" },
    { slot: "bottom", body: "male", pattern: "panels", color: "#0f8f8a", color2: "#f4f1ea", tier: "common", name: "Reef Teal" },
  ];
  const oldIds = ["gen:top:male:stripes:0f8f8a:f4f1ea", "gen:suit:male:palm:8fcf4a:13261b", "gen:top:female:chevron:e8574a:fff1e6", "gen:bottom:male:panels:0f8f8a:f4f1ea"];
  const migrated = sanitize({ v: 2, gear: oldGear, owned: oldIds, loadout: { body: "female", skin: "#6e3a22", bottom: "bikini-teal", top: oldIds[2], board: "board-blue" } });
  assert.deepEqual(migrated.gear.map((g) => `${g.slot}:${g.body}:${g.pattern}`), ["set:female:chevron", "bottom:male:panels"]);
  assert.ok(migrated.owned.includes("gen:set:female:chevron:e8574a:fff1e6"), "the women's rashguard is now the matching set");
  assert.ok(migrated.owned.includes("gen:bottom:male:panels:0f8f8a:f4f1ea"));
  assert.ok(!migrated.owned.some((id) => id.startsWith("gen:top:") || id.startsWith("gen:suit:male")));
  assert.equal(migrated.loadout.bottom, "gen:set:female:chevron:e8574a:fff1e6", "a woman who wore a rashguard wears the set");
  const again = sanitize(JSON.parse(JSON.stringify(migrated)));
  assert.deepEqual(again, migrated, "migration must be idempotent");
});
ok("old save ids migrate to the saved body's item, ownership kept for the body that still has the item", () => {
  const old = {
    v: 1,
    nextTour: 7,
    owned: ["trunks-red", "rash-white", "rash-reef", "onesie-blue", "bikini-sunset"],
    loadout: { body: "female", skin: "#c68642", bottom: "onesie-blue", top: null, board: "board-blue" },
  };
  const s = sanitize(old);
  assert.equal(s.loadout.bottom, "fullsuit-blue-f");
  for (const id of ["rash-white-f", "rash-reef-f", "fullsuit-blue-f", "bikini-sunset"]) assert.ok(s.owned.includes(id), `${id} lost`);
  for (const id of ["rash-white-m", "rash-reef-m", "fullsuit-blue-m"]) assert.ok(!s.owned.includes(id), `${id} no longer exists`);
  assert.deepEqual([s.season, s.event], [1, 7], "nextTour 7 is season 1 event 7");
  const maleOld = sanitize({ owned: ["rash-reef"], loadout: { body: "male", skin: "#6e3a22", bottom: "trunks-red", top: "rash-reef", board: "board-blue" } });
  assert.equal(maleOld.loadout.bottom, "trunks-red");
  assert.equal("top" in maleOld.loadout, false);
  const again = sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(again, s, "migration must be idempotent");
});
ok("every owned id of an old save survives for the body that still has it (nothing dropped but unknown ids and men's tops and suits)", () => {
  const legacy = ["rash-white", "rash-reef", "rash-gold", "onesie-blue", "onesie-stealth"];
  const s = sanitize({ owned: [...legacy, "not-an-item"], loadout: { body: "male", skin: "#6e3a22", bottom: "trunks-red", board: "board-blue" } });
  for (const id of legacy) {
    const family = catalog.legacyIds[id];
    assert.ok(s.owned.includes(`${family}-f`), `${family}-f`);
    assert.ok(!s.owned.includes(`${family}-m`), `${family}-m must not exist`);
  }
  assert.ok(!s.owned.includes("not-an-item"));
});
ok("switching body carries the matching outfit and falls back to that body's default", () => {
  const s = defaultSave();
  s.owned.push("rash-reef-f", "fullsuit-blue-f");
  s.loadout.bottom = "trunks-palm";
  switchBody(s, "female");
  assert.equal(s.loadout.body, "female");
  assert.equal(s.loadout.bottom, "bikini-teal", "board shorts have no women's counterpart");
  s.loadout.bottom = "rash-reef-f";
  switchBody(s, "male");
  assert.equal(s.loadout.bottom, "trunks-red", "a women's rashguard set has no men's counterpart");
  s.loadout.bottom = "trunks-palm";
  switchBody(s, "female");
  switchBody(s, "male");
  assert.equal(s.loadout.bottom, "trunks-red");
});
ok("equip rejects an item made for the other body", () => {
  const s = defaultSave();
  s.owned.push("bikini-sunset");
  throws(() => equipItem(s, "bikini-sunset"), /made for the female body/);
  switchBody(s, "female");
  assert.equal(equipItem(s, "bikini-sunset"), true);
  assert.equal(s.loadout.bottom, "bikini-sunset");
  throws(() => equipItem(s, "trunks-navy"), /made for the male body/);
});
ok("the Locker lists only the active body's outfits", () => {
  for (const body of ["male", "female"]) {
    for (const item of [...outfitsFor(body), ...bottomsFor(body)]) assert.equal(item.body, body);
  }
  assert.ok(bottomsFor("male").every((i) => i.style === "trunks"), "men's outfits are board shorts only");
  assert.ok(bottomsFor("female").every((i) => i.style !== "trunks"));
  assert.ok(bottomsFor("female").some((i) => i.style === "rashset"));
});
ok("rewards never grant an item made for the other body (every tier, 400 draws per body, and 300 settled finishes per body)", () => {
  let granted = 0;
  for (const body of ["male", "female"]) {
    for (const tier of ["common", "rare", "epic"]) {
      for (let seed = 1; seed <= 400; seed++) {
        const s = defaultSave();
        switchBody(s, body);
        const item = grantReward(s, tier, mulberry32(seed));
        granted++;
        assert.ok(!item.body || item.body === body, `${body} ${tier} seed ${seed} granted ${item.id} (${item.body})`);
        assert.notEqual(item.tier, "premium");
        assert.equal(item.reward, tier);
      }
    }
    const s = defaultSave();
    switchBody(s, body);
    for (let i = 0; i < 300; i++) {
      const r = settleFinish(s, [1, 2, 4, 8, 16][i % 5]);
      if (!r.gear) continue;
      granted++;
      assert.ok(!r.gear.body || r.gear.body === body, `${body} finish ${i} granted ${r.gear.id} (${r.gear.body})`);
      assert.notEqual(r.gear.tier, "premium");
    }
  }
  assert.ok(granted > 2000, `only ${granted} grants`);
});
ok("a body is first granted every authored (non-premium) reward made for it, tier by tier, then generated gear", () => {
  for (const body of ["male", "female"]) {
    for (const tier of ["common", "rare", "epic"]) {
      const s = defaultSave();
      switchBody(s, body);
      const expected = [...catalog.outfits, ...catalog.boards].filter((i) => i.reward === tier && i.tier !== "premium" && (!i.body || i.body === body)).map((i) => i.id).sort();
      const got = [];
      for (let i = 0; i < expected.length; i++) got.push(grantReward(s, tier, mulberry32(i + 1)).id);
      assert.deepEqual(got.sort(), expected, `${body} ${tier}`);
      assert.equal(grantReward(s, tier, mulberry32(99)).generated, true, `${body} ${tier}: the next piece is generated`);
    }
  }
});

// ---- the surfer ---------------------------------------------------------------------------------------------------
const surfer = await createSurfer({ textures: false });
const visibleGarments = (rig) => ["trunks", "bikiniBottom", "bikiniTop", "rash", "fullsuit", "springsuit"].filter((n) => rig.meshes[n]?.visible).sort();
const loadoutFor = (item) => ({ body: item.body, skin: "#c68642", bottom: item.id, board: "board-blue" });
ok("the male glb has board shorts only (no bikini, no rashguard, no suit) and the female glb has no trunks", () => {
  assert.equal(surfer.male.meshes.bikiniBottom, undefined);
  assert.equal(surfer.male.meshes.bikiniTop, undefined);
  for (const name of ["rash", "fullsuit", "springsuit"]) assert.equal(surfer.male.meshes[name], undefined, `the male glb still has a ${name}`);
  assert.equal(surfer.female.meshes.trunks, undefined);
  assert.ok(surfer.male.meshes.trunks && surfer.female.meshes.bikiniBottom && surfer.female.meshes.bikiniTop);
});
ok("apply() throws for a bikini on the male, trunks on the female, and any outfit made for the other body", () => {
  const base = { skin: "#c68642", board: "board-blue" };
  throws(() => surfer.apply({ ...base, body: "male", bottom: "bikini-teal" }, byId), /made for the female body, not the male body/);
  throws(() => surfer.apply({ ...base, body: "female", bottom: "trunks-red" }, byId), /made for the male body, not the female body/);
  throws(() => surfer.apply({ ...base, body: "female", bottom: "bikini-teal", top: "rash-white-f" }, byId), /no separate tops/);
  throws(() => surfer.apply({ ...base, body: "male", bottom: "rash-white-f" }, byId), /made for the female body/);
  throws(() => surfer.apply({ ...base, body: "male", bottom: "fullsuit-blue-f" }, byId), /made for the female body/);
  throws(() => surfer.apply({ ...base, body: "male", bottom: "no-such-item" }, byId), /not in the catalog/);
});
ok("every outfit applies on its own body and shows exactly the garments it should", () => {
  for (const item of catalog.outfits) {
    const loadout = loadoutFor(item);
    surfer.apply(loadout, byId);
    const rig = surfer.active;
    assert.equal(rig.kind, item.body, item.id);
    const shown = visibleGarments(rig);
    const other = item.body === "male" ? surfer.female : surfer.male;
    assert.deepEqual(visibleGarments(other), [], `${item.id}: the other body shows a garment`);
    const expect = {
      trunks: ["trunks"],
      bikini: ["bikiniBottom", "bikiniTop"],
      fullsuit: ["fullsuit"],
      springsuit: ["springsuit"],
      rashset: ["bikiniBottom", "rash"],
    }[item.style];
    assert.ok(expect, `${item.id}: unknown style ${item.style}`);
    assert.deepEqual(shown, expect.slice().sort(), item.id);
    // a matching set: every garment the outfit shows wears the item's one pattern and one colour pair
    for (const name of expect) {
      const worn = rig.meshes[name].userData.print;
      assert.deepEqual([worn.pattern, worn.c1, worn.c2], [item.pattern, item.color, item.color2 || item.color], `${item.id}: ${name} does not match the set`);
    }
  }
});

console.log(`gender checks passed (${checks} groups)`);
