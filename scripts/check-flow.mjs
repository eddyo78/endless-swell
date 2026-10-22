// End-to-end check of the season flow in the real page (milestone 4).
//   node scripts/check-flow.mjs [--skip-build]
// Builds, serves dist/ on a local port for the life of this script, drives headless Chrome through the window.__surf test hooks
// and the real buttons, and asserts: a version 1 save opens at the right Season and Event with every item; the screens say
// "Season S · Event E" and never a level number; the top-4 gate (a quarterfinal win banks the advance even if you leave);
// a failed event offers a retry with a new draw; points, rank, trophies and gear arrive; rule twists change the heat
// (season 4 short heat, season 8 two-wave set, season 7 side-shore wind); generated gear is in the Locker and wearable.
// The browser and the server are closed in a finally block. Needs a local Chrome (CHROME_PATH or the usual Mac path).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { seasonTwist, twistLabel } from "../src/competition.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const CHROME = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) throw new Error("no Chrome found; set CHROME_PATH");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

if (!process.argv.includes("--skip-build")) {
  const r = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`npm run build exited ${r.status}`);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = join(dist, rel);
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;

let checks = 0;
const problems = [];
async function ok(label, fn) {
  await fn();
  checks++;
  console.log(`ok   ${label}`);
}

const V1 = {
  v: 1,
  nextTour: 23,
  results: [{ tour: 20, place: 2, at: 5 }, { tour: 21, place: 1, at: 6 }, { tour: 22, place: 4, at: 7 }],
  owned: ["trunks-red", "trunks-navy", "trunks-palm", "bikini-teal", "rash-white", "rash-reef", "onesie-blue", "bikini-sunset", "board-blue", "board-chevron", "board-sun", "board-stripe", "board-tiger"],
  loadout: { body: "female", skin: "#c68642", bottom: "bikini-sunset", top: "rash-reef", board: "board-tiger" },
  quality: "low",
  best: 7.4,
};

let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=metal", "--window-size=1280,720"],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });

  async function open(seedV1) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
    });
    if (seedV1) await page.evaluateOnNewDocument((v1) => localStorage.setItem("endless-swell-save-v1", JSON.stringify(v1)), V1);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
    await page.evaluate(() => {
      window.__surf.pause = true;
    });
    return { page, context };
  }
  const text = (page) => page.evaluate(() => document.getElementById("panels").innerText);
  const click = async (page, sel) => {
    await page.click(sel);
    await page.evaluate(() => window.__surf.advance(0.05));
  };
  const S = (page, fn, ...args) => page.evaluate((src, ...a) => new Function("S", "a", `return (${src})(S, ...a)`)(window.__surf, a), fn.toString(), ...args);
  const NOT_A_LEVEL = /\b(tour|level)\s*\d+/i;

  // ---- a version 1 save, opened in the page --------------------------------------------------------------------------
  {
    const { page, context } = await open(true);
    await ok("a version 1 save opens at Season 3 · Event 3 with every owned item, and the version 1 key is left alone", async () => {
      assert.deepEqual(await S(page, (s) => s.event()), { season: 3, event: 3, attempt: 0 });
      const menu = await text(page);
      assert.match(menu, /Season 3 · Event 3/);
      assert.doesNotMatch(menu, NOT_A_LEVEL);
      const owned = await S(page, (s) => s.save().owned);
      for (const id of ["bikini-sunset", "board-tiger", "board-stripe", "rash-reef-f", "fullsuit-blue-f", "trunks-palm"]) assert.ok(owned.includes(id), id);
      assert.ok(!owned.includes("rash-reef-m"), "a men's rashguard no longer exists");
      assert.equal(await page.evaluate(() => localStorage.getItem("endless-swell-save-v1")), JSON.stringify(V1));
      const save = await S(page, (s) => s.save());
      assert.equal(save.loadout.body, "female");
      assert.equal(save.loadout.board, "board-tiger");
    });
    await ok("the migrated page plays an event: the brief says Season 3 · Event 3 and never the level number", async () => {
      await click(page, "#play-tour");
      const brief = await text(page);
      assert.match(brief, /SEASON 3 · EVENT 3/);
      assert.doesNotMatch(brief, NOT_A_LEVEL);
      assert.doesNotMatch(brief, /\b23\b/);
    });
    await context.close();
  }

  // ---- a new player: gate, banking, retry, points, rank -------------------------------------------------------------
  const { page, context } = await open(false);
  await ok("a new save: the menu says Season 1 · Event 1, shows the first rank and an empty trophy shelf, and no level number", async () => {
    const menu = await text(page);
    assert.match(menu, /Season 1 · Event 1 is waiting/);
    assert.match(menu, /Qualifier · 0 pts · 100 to Challenger/);
    assert.match(menu, /Trophy shelf: empty/);
    assert.doesNotMatch(menu, NOT_A_LEVEL);
  });
  await ok("the brief names the break, the swell and the rule, as Season 1 · Event 1", async () => {
    await click(page, "#play-tour");
    const brief = await text(page);
    assert.match(brief, /SEASON 1 · EVENT 1/);
    assert.match(brief, /Top 4 moves you on; winning pays more/);
    assert.match(brief, /42 seconds, up to 3 waves/);
    assert.doesNotMatch(brief, NOT_A_LEVEL);
  });
  await ok("winning the quarterfinal secures the top 4: leaving from that screen banks 4th place, 50 points and the next event", async () => {
    await click(page, "#begin-heat");
    assert.equal((await S(page, (s) => s.heat())).round, "Round of 16");
    await S(page, (s) => s.finishHeat(9, 0));
    assert.match(await text(page), /Heat won/);
    assert.equal((await S(page, (s) => s.event())).event, 1, "nothing is booked after only the first win");
    await click(page, "#next-heat");
    assert.equal((await S(page, (s) => s.heat())).round, "Quarterfinal");
    await S(page, (s) => s.finishHeat(9, 0));
    const t = await text(page);
    assert.match(t, /Top 4 secured/);
    assert.match(t, /Leaving now keeps your semifinal \(top 4\) finish/);
    await click(page, "#heat-menu");
    const save = await S(page, (s) => s.save());
    assert.deepEqual([save.season, save.event, save.attempt], [1, 2, 0]);
    assert.equal(save.points, 50);
    assert.equal(save.results.length, 1);
    assert.equal(save.results[0].place, 4);
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("endless-swell-save-v2")));
    assert.equal(stored.v, 2);
    assert.equal(stored.event, 2);
    assert.equal(await page.evaluate(() => localStorage.getItem("endless-swell-save-v1")), null, "a new player gets no version 1 key");
    assert.match(await text(page), /Season 1 · Event 2 is waiting/);
    assert.match(await text(page), /Qualifier · 50 pts · 50 to Challenger/);
  });
  await ok("losing the first heat is a failed event: out of the event, 10 points, retry on the same event, a new draw", async () => {
    await click(page, "#play-tour");
    await click(page, "#begin-heat");
    const first = await S(page, (s) => s.heat().opponent);
    await S(page, (s) => s.finishHeat(0, 9));
    assert.match(await text(page), /Heat lost/);
    await click(page, "#tour-done");
    const t = await text(page);
    assert.match(t, /Out of the event/);
    assert.match(t, /SEASON 1 · EVENT 2 · ROUND OF 16/);
    assert.match(t, /\+10 ranking points/);
    assert.match(t, /A top-4 finish \(winning the quarterfinal\) moves you on/);
    assert.match(t, /Retry event/);
    assert.doesNotMatch(t, /Season 1 · Event 3 is open/);
    const save = await S(page, (s) => s.save());
    assert.deepEqual([save.season, save.event, save.attempt, save.points, save.pity], [1, 2, 1, 60, 1]);
    await click(page, "#retry-tour");
    assert.match(await text(page), /Attempt 2: same conditions, a new draw/);
    await click(page, "#begin-heat");
    const second = await S(page, (s) => s.heat().opponent);
    console.log(`     attempt 1 first opponent ${first}, attempt 2 first opponent ${second}`);
    await S(page, (s) => s.menu());
  });
  await ok("a clean win of a whole event: Winner, 120 points, the next event, rank progress shown", async () => {
    await click(page, "#play-tour");
    await click(page, "#begin-heat");
    for (let round = 0; round < 3; round++) {
      await S(page, (s) => s.finishHeat(9, 0));
      await click(page, "#next-heat");
    }
    await S(page, (s) => s.finishHeat(9, 0));
    assert.match(await text(page), /Heat won/);
    await click(page, "#tour-done");
    const t = await text(page);
    assert.match(t, /Event won/);
    assert.match(t, /WINNER/);
    assert.match(t, /\+120 ranking points/);
    assert.match(t, /Season 1 · Event 3 is open/);
    assert.match(t, /Rank up: Qualifier → Challenger/);
    const save = await S(page, (s) => s.save());
    assert.deepEqual([save.season, save.event, save.attempt], [1, 3, 0]);
    assert.ok(save.points >= 100);
    await click(page, "#end-menu");
  });

  // ---- through three seasons: finale trophies, gear, twists ---------------------------------------------------------
  async function playOut(place) {
    // open the event the save is on and settle it with this finish through the real conclude()
    await S(page, (s) => s.startTour());
    await S(page, (s, p) => s.forceFinish(p), place);
  }
  await ok("a Season Finale top 4 puts a trophy on the shelf, shown on the results screen and the menu; the season rolls over", async () => {
    let save = await S(page, (s) => s.save());
    while (save.season === 1) {
      await playOut(save.event === 10 ? 2 : 1);
      save = await S(page, (s) => s.save());
    }
    const t = await text(page);
    assert.match(t, /Trophy for the shelf: Season 1 Finale · Runner-up/);
    assert.match(t, /Season 2 begins: a new calendar/);
    assert.match(t, /SEASON 1 · EVENT 10 · RUNNER-UP/);
    assert.doesNotMatch(t, NOT_A_LEVEL);
    assert.deepEqual([save.season, save.event], [2, 1]);
    assert.deepEqual(save.trophies.map((x) => [x.season, x.place]), [[1, 2]]);
    await click(page, "#end-menu");
    const menu = await text(page);
    assert.match(menu, /Trophy shelf · 1/);
    assert.match(menu, /Season 1 · Runner-up/);
    assert.match(menu, /Season 2 · Event 1 is waiting/);
  });
  await ok("gear arrives: placement pieces are saved as recipes and listed in the Locker for the body won with", async () => {
    const save = await S(page, (s) => s.save());
    assert.ok(save.gear.length >= 5, `${save.gear.length} generated pieces after one season (the rest of the ten are authored)`);
    for (const g of save.gear) assert.ok(["board", "bottom", "set", "suit"].includes(g.slot) && /^#[0-9a-f]{6}$/.test(g.color));
    await click(page, "#open-locker");
    const t = await text(page);
    assert.match(t, /pieces won by placement/);
    const earned = await page.evaluate(() => [...document.querySelectorAll(".item")].filter((b) => /Earned ·/.test(b.innerText)).length);
    assert.equal(earned, save.gear.length, `${earned} earned items listed for ${save.gear.length} recipes`);
    // wear one generated board and one generated outfit
    const ids = await page.evaluate(() => [...document.querySelectorAll(".item")].filter((b) => /Earned ·/.test(b.innerText)).map((b) => b.dataset.equip));
    const board = ids.find((id) => id.startsWith("gen:board"));
    assert.ok(board, "a generated board");
    await page.click(`[data-equip="${board}"]`);
    await page.evaluate(() => window.__surf.advance(0.05));
    assert.equal((await S(page, (s) => s.save().loadout.board)), board);
    const top = ids.find((id) => id.startsWith("gen:set") || id.startsWith("gen:bottom") || id.startsWith("gen:suit"));
    if (top) {
      await page.click(`[data-equip="${top}"]`);
      await page.evaluate(() => window.__surf.advance(0.05));
    }
    await click(page, "#locker-back");
    // the reload keeps it
    const before = await S(page, (s) => s.save());
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
    const after = await S(page, (s) => s.save());
    assert.deepEqual(after.gear, before.gear);
    assert.equal(after.loadout.board, board);
    assert.deepEqual(after.owned, before.owned);
    await page.evaluate(() => {
      window.__surf.pause = true;
    });
  });
  await ok("season 4 carries its twist: the brief names it and the short heat is 30 seconds", async () => {
    let save = await S(page, (s) => s.save());
    while (save.season < 4) {
      await playOut(1);
      save = await S(page, (s) => s.save());
    }
    await S(page, (s) => s.menu());
    assert.equal(seasonTwist(4), "short-heat");
    await click(page, "#play-tour");
    const brief = await text(page);
    assert.ok(brief.includes(twistLabel("short-heat")), brief);
    assert.match(brief, /Heat: 30 seconds/);
    await click(page, "#begin-heat");
    const heat = await S(page, (s) => s.heat());
    assert.equal(heat.max, 30);
    assert.equal(heat.limit, 3);
    assert.deepEqual(heat.windows, [0, 8.6, 17.1]);
    await S(page, (s) => s.menu());
  });
  await ok("season 7 side-shore wind: the brief says which way it pushes and a whole autopilot heat runs clean", async () => {
    let save = await S(page, (s) => s.save());
    while (save.season < 7) {
      await playOut(1);
      save = await S(page, (s) => s.save());
    }
    assert.equal(seasonTwist(7), "sideshore-wind");
    await S(page, (s) => s.menu());
    await click(page, "#play-tour");
    const brief = await text(page);
    assert.match(brief, /Wind sideshore · pushes you down toward the trough/);
    await click(page, "#begin-heat");
    await S(page, (s) => s.setAutopilot(true));
    let guard = 0;
    while ((await S(page, (s) => s.mode())) !== "result" && guard++ < 4000) await page.evaluate(() => window.__surf.advance(1 / 4));
    assert.equal(await S(page, (s) => s.mode()), "result", "the heat ended");
    await S(page, (s) => s.setAutopilot(false));
    await S(page, (s) => s.menu());
  });
  await ok("season 8 two-wave set: the heat allows two waves and the brief says both count", async () => {
    let save = await S(page, (s) => s.save());
    while (save.season < 8) {
      await playOut(1);
      save = await S(page, (s) => s.save());
    }
    assert.equal(seasonTwist(8), "two-wave-set");
    await S(page, (s) => s.menu());
    await click(page, "#play-tour");
    assert.match(await text(page), /two waves, both count/);
    await click(page, "#begin-heat");
    const heat = await S(page, (s) => s.heat());
    assert.equal(heat.limit, 2);
    assert.equal(heat.max, 42);
    assert.deepEqual(heat.windows, [0, 12]);
    await S(page, (s) => s.menu());
  });
  await ok("season 9 dry reef: the brief says so, a third reef section is drawn (six rocks), and an autopilot heat runs clean", async () => {
    let save = await S(page, (s) => s.save());
    while (save.season < 9) {
      await playOut(1);
      save = await S(page, (s) => s.save());
    }
    assert.equal(seasonTwist(9), "dry-reef");
    await S(page, (s) => s.menu());
    await click(page, "#play-tour");
    assert.ok((await text(page)).includes(twistLabel("dry-reef")));
    await click(page, "#begin-heat");
    await S(page, (s) => s.advance(1));
    assert.equal(await S(page, (s) => s.world().reef.children.filter((r) => r.visible).length), 6);
    await S(page, (s) => s.setAutopilot(true));
    let guard = 0;
    while ((await S(page, (s) => s.mode())) !== "result" && guard++ < 4000) await page.evaluate(() => window.__surf.advance(1 / 4));
    assert.equal(await S(page, (s) => s.mode()), "result");
    await S(page, (s) => s.setAutopilot(false));
    await S(page, (s) => s.menu());
  });
  await ok("a locked stop is shown as locked and an unbuilt free stop as not built yet, each surfed on Teahupo'o", async () => {
    // season 1's calendar has Beachbreak at event 2 and a premium break at event 4 (scripts/check-tour.mjs prints it)
    const { page: p2, context: c2 } = await open(false);
    const seen = new Set();
    for (const event of [2, 4, 9]) {
      await p2.evaluate((e) => {
        const S = window.__surf;
        S.save().event = e;
        S.menu();
      }, event);
      await click(p2, "#play-tour");
      const brief = await text(p2);
      if (/LOCKED/.test(brief)) {
        assert.match(brief, /is locked \(a premium break\)\. This stop is surfed at Teahupo'o\./);
        seen.add("locked");
      }
      if (/NOT BUILT YET/.test(brief)) {
        assert.match(brief, /Beachbreak is free but not built yet\. This stop is surfed at Teahupo'o\./);
        seen.add("soon");
      }
    }
    assert.deepEqual([...seen].sort(), ["locked", "soon"]);
    await c2.close();
  });
  // ---- the warm-up and the play log (Ed, 2026-10-21) ------------------------------------------------------------------
  // A bad rider (ride.js poorAutopilot: no input on the first wave of every heat, so it wipes out; short pumping effort after)
  // plays the real Round of 16 and Quarterfinal of Season 1 Event 1 on four different draws (attempts 0-3).
  {
    const { page: p3, context: c3 } = await open(false);
    const finishHeat = async () => {
      let guard = 0;
      while ((await S(p3, (s) => s.mode())) !== "result" && guard++ < 4000) await p3.evaluate(() => window.__surf.advance(1 / 4));
      assert.equal(await S(p3, (s) => s.mode()), "result", "the heat ended");
    };
    const playTop4 = async (attempt) => {
      await p3.evaluate((a) => {
        const S = window.__surf;
        S.save().attempt = a;
        S.menu();
      }, attempt);
      await click(p3, "#play-tour");
      await click(p3, "#begin-heat");
      assert.deepEqual(await S(p3, (s) => [s.heat().round, s.heat().max, s.heat().limit]), ["Round of 16", 42, 3]);
      await S(p3, (s) => s.setAutopilot(true, "poor"));
      await finishHeat();
      const first = await text(p3);
      const heat1 = await S(p3, (s) => s.save().playLog.heats.at(-1));
      assert.match(first, /Heat won/, `attempt ${attempt}: round of 16 lost, ${JSON.stringify(heat1)}`);
      await S(p3, (s) => s.setAutopilot(false));
      await click(p3, "#next-heat");
      assert.equal((await S(p3, (s) => s.heat())).round, "Quarterfinal");
      await S(p3, (s) => s.setAutopilot(true, "poor"));
      await finishHeat();
      const heat2 = await S(p3, (s) => s.save().playLog.heats.at(-1));
      const second = await text(p3);
      assert.match(second, /Top 4 secured/, `attempt ${attempt}: quarterfinal lost, ${JSON.stringify(heat2)}`);
      await S(p3, (s) => s.setAutopilot(false));
      return [heat1, heat2];
    };
    await ok("warm-up: a bad rider (wipes out the first wave of every heat, then short pumping rides) finishes top 4 in Season 1 · Event 1 on four different draws", async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const [h1, h2] = await playTop4(attempt);
        console.log(`     attempt ${attempt + 1}: round of 16 ${h1.playerTotal} v ${h1.rivalTotal} (${h1.playerWaves.join(", ")}); quarterfinal ${h2.playerTotal} v ${h2.rivalTotal} (${h2.playerWaves.join(", ")})`);
        assert.ok(h1.rivalTotal <= 6 && h2.rivalTotal <= 6, `Event 1 rivals are soft: ${h1.rivalTotal}, ${h2.rivalTotal}`);
      }
    });
    await ok("warm-up: the first wipeout of a heat scores what it earned and the heat gives a fresh wave; a second wipeout is not forgiven", async () => {
      await S(p3, (s) => s.menu());
      await click(p3, "#play-tour");
      await click(p3, "#begin-heat");
      const waves = [];
      let guard = 0;
      while ((await S(p3, (s) => s.mode())) !== "result" && guard++ < 4000) {
        // paddle in (throttle on), then no input at all in the ride: every wave wipes out
        await p3.evaluate(() => window.__surf.setInput(0, window.__surf.mode() === "paddle" ? 1 : 0));
        await p3.evaluate(() => window.__surf.advance(1 / 4));
        const mode = await S(p3, (s) => s.mode());
        if (mode === "gap") {
          const heat = await S(p3, (s) => s.heat());
          waves.push([heat.waves.length, heat.limit, heat.max]);
          await p3.evaluate(() => window.__surf.advance(1.5));
        }
      }
      await S(p3, (s) => s.setAutopilot(false));
      const log = await S(p3, (s) => s.save().playLog.waves.slice(-5));
      const mine = log.filter((w) => w.round === "Round of 16" && w.wipe);
      assert.ok(mine.length >= 2, `at least two wipeouts logged: ${JSON.stringify(mine.map((w) => [w.score, w.forgiven]))}`);
      assert.equal(mine[0].forgiven, true);
      assert.ok(mine[0].score > 0, `the forgiven wipeout scored ${mine[0].score}`);
      assert.equal(mine[1].forgiven, false, "only the first wipeout of a heat is forgiven");
      assert.ok(mine[1].score < mine[0].score);
      assert.deepEqual(waves[0].slice(1), [4, 54], `after the forgiven wipeout the heat has 4 waves and 54 s: ${JSON.stringify(waves)}`);
    });
    await ok("play log: waves and heats are recorded as played (season, event, round, score and parts, ride and tube time, wipe and cause, rival totals, placement) and survive a reload", async () => {
      const log = await S(p3, (s) => s.save().playLog);
      assert.equal(log.v, 1);
      const w = log.waves.find((x) => x.round === "Quarterfinal" && !x.wipe);
      assert.ok(w, "a ridden quarterfinal wave");
      assert.deepEqual([w.season, w.event, w.round], [1, 1, "Quarterfinal"]);
      assert.ok(w.score > 0 && w.rideSeconds > 1 && "tube" in w.parts && "speed" in w.parts && typeof w.tubeSeconds === "number");
      const wipe = log.waves.find((x) => x.wipe);
      assert.ok(wipe && /\S/.test(wipe.cause), "a wipeout has its cause");
      const h = log.heats.at(-2);
      assert.ok(h.rival && h.rivalTotal > 0 && h.playerTotal > 0 && Array.isArray(h.playerWaves) && Array.isArray(h.rivalWaves) && typeof h.won === "boolean");
      // bank the top 4 and see the event placement land on the last heat
      await S(p3, (s) => s.startTour());
      await S(p3, (s) => s.forceFinish(4));
      assert.equal((await S(p3, (s) => s.save().playLog.heats.at(-1))).eventPlace, 4);
      const before = await S(p3, (s) => s.save().playLog);
      await p3.reload({ waitUntil: "load" });
      await p3.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
      assert.deepEqual(await S(p3, (s) => s.save().playLog), before, "the log survives a reload");
      await p3.evaluate(() => {
        window.__surf.pause = true;
      });
    });
    await ok("play log: Shift+L downloads the log as a JSON file with the same waves and heats", async () => {
      await p3.evaluate(() => {
        window.__dl = [];
        const orig = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download) {
            window.__dl.push({ name: this.download, href: this.href });
            return undefined;
          }
          return orig.call(this);
        };
      });
      await p3.keyboard.down("Shift");
      await p3.keyboard.press("KeyL");
      await p3.keyboard.up("Shift");
      const got = await p3.evaluate(async () => {
        const d = window.__dl[0];
        return d ? { name: d.name, text: await (await fetch(d.href)).text() } : null;
      });
      assert.ok(got, "a file was offered for download");
      assert.match(got.name, /^endless-swell-playlog-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
      const file = JSON.parse(got.text);
      const hook = await S(p3, (s) => s.exportLog());
      assert.equal(file.game, "endless-swell");
      assert.deepEqual(file.waves, hook.waves);
      assert.deepEqual(file.heats, hook.heats);
      assert.ok(file.waves.length >= 6 && file.heats.length >= 3, `${file.waves.length} waves, ${file.heats.length} heats exported`);
      // a plain L (no Shift) does nothing
      await p3.evaluate(() => {
        window.__dl = [];
      });
      await p3.keyboard.press("KeyL");
      assert.equal(await p3.evaluate(() => window.__dl.length), 0);
    });
    await c3.close();
  }
  await ok("no page errors or console errors in the whole run", async () => {
    assert.deepEqual(problems, []);
  });
  await context.close();
  console.log(`flow checks passed (${checks} groups)`);
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
process.exit(0);
