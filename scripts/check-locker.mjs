// End-to-end check of the Locker's pictures (milestone 6), in the real built game in headless Chrome.
//   node scripts/check-locker.mjs [--skip-build]
// Builds (unless --skip-build), serves dist/ on a local port for the life of the script, and for the male at desktop width and the
// female at desktop and phone width asserts:
//   - the studio is ready and every card in the list (scrolled through, so every lazy picture is asked for) has a picture that is
//     not blank (enough pixels differ from the card's own backdrop);
//   - the preview renders (the stage area is not a flat colour) and the whole surfer is inside the frame: the head has at least 6%
//     of the stage above it and the plate and its sides are inside (projected extents, window.__surf.locker().state().fit);
//   - the skin swatches in the Locker change the tone, save it and repaint the preview and the body cards; and skin (six tones) and
//     cloth (every catalog and gear colour) measure as their swatches in the studio light (runs scripts/studio-calibrate.mjs check);
//   - trying on every locked premium card previews it (badge says LOCKED, the preview loadout and the dressed meshes carry it) and
//     does NOT equip it: the loadout and the saved game are unchanged; clicking an owned card does equip and save it;
//   - closing disposes what the Locker created: after one warm-up open and close (the other body's textures upload once), the
//     renderer's geometry and texture counts, the live listeners on window, document and the page, and the tone mapping, exposure
//     and holder parent are identical after each of three more open and close cycles, the Locker's own elements hold no listener,
//     and an open followed at once by a close leaves no error.
// The browser and the server are closed in a finally block. Needs a local Chrome (CHROME_PATH or the usual Mac path).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const CHROME = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) throw new Error("no Chrome found; set CHROME_PATH");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

if (!process.argv.includes("--skip-build")) {
  const r = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "ignore" });
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

const problems = [];
let checks = 0;
async function ok(label, fn) {
  await fn();
  checks++;
  console.log(`ok   ${label}`);
}

// Counts the listeners that are still attached, by target: window, document, and every element (so detached ones can be told from live).
const TRACK_LISTENERS = () => {
  const live = new Map(); // target -> Set of keys
  const ids = new WeakMap();
  let next = 1;
  const keyOf = (type, fn, opts) => `${type}|${ids.get(fn) || (ids.set(fn, next++), ids.get(fn))}|${typeof opts === "object" ? !!opts.capture : !!opts}`;
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (fn) {
      if (!live.has(this)) live.set(this, new Set());
      live.get(this).add(keyOf(type, typeof fn === "function" ? fn : fn.handleEvent, opts));
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    if (fn && live.has(this)) live.get(this).delete(keyOf(type, typeof fn === "function" ? fn : fn.handleEvent, opts));
    return remove.call(this, type, fn, opts);
  };
  window.__listeners = () => {
    let persistent = 0;
    let locker = 0;
    for (const [target, keys] of live) {
      const own = target === window || target === document || (target.isConnected && !(target.closest && target.closest("#panels")));
      if (own) persistent += keys.size;
      if (target.id === "lk-view" || target.id === "lk-list" || target.id === "lk-skin" || target.id === "locker-back") locker += keys.size;
    }
    return { persistent, locker };
  };
};

let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=metal", "--window-size=1440,900"],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });

  async function open(body, viewport) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
    });
    await page.evaluateOnNewDocument(TRACK_LISTENERS);
    await page.setViewport(viewport);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
    await page.evaluate((b) => {
      const S = window.__surf;
      S.pause = true;
      S.setBody(b);
      for (let i = 0; i < 4; i++) S.grantGear("common", 10 + i);
      for (let i = 0; i < 4; i++) S.grantGear("rare", 20 + i);
      for (let i = 0; i < 2; i++) S.grantGear("epic", 30 + i);
      S.menu();
    }, body);
    return { page, context };
  }
  const openLocker = async (page) => {
    await page.click("#open-locker");
    await page.waitForFunction(() => { const v = window.__surf.locker(); return v && v.ready && v.pending === 0 && v.stats.stageFrames > 3; }, { timeout: 120000 });
  };
  const closeLocker = async (page) => {
    await page.click("#locker-back");
    await page.waitForFunction(() => window.__surf.locker() === null, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 150));
  };
  const frames = (page, n = 4) => page.evaluate((count) => new Promise((resolve) => { let i = 0; const tick = () => (++i >= count ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);
  const gl = (page) => page.evaluate(() => {
    const w = window.__surf.world();
    const r = w.renderer;
    return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, toneMapping: r.toneMapping, exposure: r.toneMappingExposure, holderInScene: w.surfer.holder.parent === w.scene, listeners: window.__listeners() };
  });

  const cases = [
    { body: "male", viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, name: "male, desktop" },
    { body: "female", viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, name: "female, desktop" },
    { body: "female", viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, name: "female, phone" },
  ];
  for (const c of cases) {
    const { page, context } = await open(c.body, c.viewport);
    await openLocker(page);
    console.log(`     ${c.name}: ${JSON.stringify(await page.evaluate(() => ({ ...window.__surf.locker().stats, pictures: window.__surf.lockerPictures() })))}`);

    await ok(`${c.name}: every card in the list gets a picture that is not blank`, async () => {
      const total = await page.evaluate(() => document.querySelectorAll("#lk-list .item").length);
      assert.ok(total >= 13, `${total} cards`);
      // scroll through the list in steps so each lazy card is on screen, waiting for the pictures each time
      const height = await page.evaluate(() => document.querySelector("#lk-list").scrollHeight);
      for (let y = 0; y <= height; y += 220) {
        await page.evaluate((top) => { document.querySelector("#lk-list").scrollTop = top; }, y);
        await page.waitForFunction(() => window.__surf.locker().pending === 0, { timeout: 60000 });
        await frames(page, 3);
      }
      const cards = await page.evaluate(() => [...document.querySelectorAll("#lk-list .item")].map((card) => {
        const canvas = card.querySelector("canvas");
        const ctx = canvas.getContext("2d");
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const bg = [data[0], data[1], data[2]];
        let differ = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])) > 30) differ++;
        }
        return { id: card.dataset.equip, painted: canvas.dataset.pic === "1", differ: differ / (width * height) };
      }));
      assert.equal(cards.length, total);
      for (const card of cards) {
        assert.ok(card.painted, `${card.id}: no picture was drawn`);
        assert.ok(card.differ >= 0.04, `${card.id}: picture looks blank (${(card.differ * 100).toFixed(1)}% of pixels differ from its backdrop)`);
      }
      const least = cards.reduce((a, b) => (a.differ < b.differ ? a : b));
      console.log(`     ${cards.length} cards, least busy picture ${least.id} (${(least.differ * 100).toFixed(1)}% of pixels differ from the backdrop)`);
      await page.evaluate(() => { document.querySelector("#lk-list").scrollTop = 0; });
    });

    await ok(`${c.name}: the preview renders and the whole surfer is inside the frame`, async () => {
      await frames(page, 4);
      const st = await page.evaluate(() => window.__surf.locker().state());
      assert.ok(st.stageTarget && st.stageTarget.w > 100 && st.stageTarget.h > 100, "the stage has no render target");
      assert.ok(st.fit, "no fit measured");
      assert.ok(st.fit.top <= 0.9, `the head is too near the top: ${st.fit.top.toFixed(2)}`);
      assert.ok(st.fit.top >= 0.35, `the surfer is too small in the frame (head at ${st.fit.top.toFixed(2)})`);
      assert.ok(st.fit.bottom >= -0.99, `the plate is cut off at the bottom: ${st.fit.bottom.toFixed(2)}`);
      assert.ok(st.fit.side <= 0.99, `the plate is cut off at the side: ${st.fit.side.toFixed(2)}`);
      const r = st.stageRect;
      const png = PNG.sync.read(await page.screenshot({ type: "png", clip: { x: r.x, y: r.y, width: r.width, height: r.height } }));
      const seen = new Set();
      let sum = 0;
      let sum2 = 0;
      for (let i = 0; i < png.data.length; i += 4) {
        const lum = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
        sum += lum;
        sum2 += lum * lum;
        seen.add((png.data[i] >> 3) | ((png.data[i + 1] >> 3) << 5) | ((png.data[i + 2] >> 3) << 10));
      }
      const n = png.data.length / 4;
      const sd = Math.sqrt(sum2 / n - (sum / n) ** 2);
      assert.ok(seen.size > 200 && sd > 12, `the stage looks flat: ${seen.size} colours, luminance sd ${sd.toFixed(1)}`);
      console.log(`     stage ${Math.round(r.width)}x${Math.round(r.height)}, head at ${st.fit.top.toFixed(2)}, plate bottom ${st.fit.bottom.toFixed(2)}, ${seen.size} colours`);
    });

    await ok(`${c.name}: trying on a locked premium card previews it, marks it locked, and equips nothing; an owned card equips and saves`, async () => {
      const locked = await page.evaluate(() => [...document.querySelectorAll("#lk-list .item[data-locked]")].filter((b) => /Premium/.test(b.innerText)).map((b) => b.dataset.equip));
      assert.ok(locked.length >= 2, `premium cards: ${locked.join(",")}`);
      const before = await page.evaluate(() => ({ loadout: JSON.stringify(window.__surf.save().loadout), stored: Object.entries(localStorage).map(([k, v]) => k + v).join("|") }));
      for (const id of locked) {
        await page.evaluate((target) => document.querySelector(`#lk-list [data-equip="${target}"]`).scrollIntoView({ block: "center" }), id);
        await page.click(`#lk-list [data-equip="${id}"]`);
        await frames(page, 6);
        await page.waitForFunction(() => window.__surf.locker().pending === 0, { timeout: 60000 });
        const got = await page.evaluate((target) => {
          const S = window.__surf;
          const view = S.locker();
          const state = view.state();
          const item = S.catalogItems();
          const entry = [...item.outfits, ...item.boards].find((i) => i.id === target);
          const surfer = S.surfer();
          const dressed = entry.shape
            ? surfer.board.children[0].userData.print
            : Object.values(surfer.active.meshes).map((m) => m.userData.print).find((p) => p && p.c1 === entry.color);
          return { state, entry, dressed: dressed ? { c1: dressed.c1, pattern: dressed.pattern } : null, loadout: JSON.stringify(S.save().loadout), mode: S.mode() };
        }, id);
        assert.equal(got.state.trying, true, `${id}: not marked as trying on`);
        assert.match(got.state.badge, /LOCKED/, `${id}: badge says ${got.state.badge}`);
        assert.match(got.state.badge, /not equipped/);
        const slot = got.entry.shape ? "board" : "bottom";
        assert.equal(got.state.previewLoadout[slot], id, `${id}: not on the preview`);
        assert.ok(got.dressed && got.dressed.c1 === got.entry.color, `${id}: the surfer is not wearing it (${JSON.stringify(got.dressed)})`);
        assert.equal(got.loadout, before.loadout, `${id}: the saved loadout changed`);
        assert.equal(await page.evaluate(() => [...document.querySelectorAll("#lk-list .item.on")].some((b) => b.dataset.locked)), false, `${id}: a locked card shows as equipped`);
      }
      assert.equal(await page.evaluate(() => Object.entries(localStorage).map(([k, v]) => k + v).join("|")), before.stored, "the stored save changed after only trying on locked items");
      // an owned, unequipped card equips and is saved
      const owned = await page.evaluate(() => [...document.querySelectorAll("#lk-list .item:not(.on):not([data-locked])")].map((b) => b.dataset.equip).filter((id) => !["male", "female"].includes(id)));
      assert.ok(owned.length, "no owned card to equip");
      await page.evaluate((target) => document.querySelector(`#lk-list [data-equip="${target}"]`).scrollIntoView({ block: "center" }), owned[0]);
      await page.click(`#lk-list [data-equip="${owned[0]}"]`);
      await frames(page, 4);
      const after = await page.evaluate(() => ({ loadout: window.__surf.save().loadout, stored: JSON.parse(localStorage.getItem("endless-swell-save-v2")).loadout, state: window.__surf.locker().state() }));
      assert.ok(Object.values(after.loadout).includes(owned[0]), `${owned[0]} was not equipped`);
      assert.deepEqual(after.stored, after.loadout, "the equip was not saved");
      assert.equal(after.state.trying, false);
    });

    await ok(`${c.name}: the Locker's skin swatches change the tone, save it, and repaint the preview and the body cards`, async () => {
      const tones = await page.evaluate(() => [...document.querySelectorAll("#lk-skin .swatch")].map((b) => b.dataset.skin));
      assert.equal(tones.length, 6, `${tones.length} swatches`);
      const current = await page.evaluate(() => window.__surf.save().loadout.skin);
      const next = tones.find((t) => t.toLowerCase() !== current.toLowerCase());
      const bodyCardBefore = await page.evaluate(() => document.querySelector('#lk-list [data-equip="male"] canvas').toDataURL());
      await page.click(`#lk-skin [data-skin="${next}"]`);
      await page.waitForFunction(() => window.__surf.locker().pending === 0, { timeout: 60000 });
      await frames(page, 4);
      const got = await page.evaluate(() => ({ loadout: window.__surf.save().loadout.skin, stored: JSON.parse(localStorage.getItem("endless-swell-save-v2")).loadout.skin, preview: window.__surf.locker().state().previewLoadout.skin, on: document.querySelector("#lk-skin .swatch.on")?.dataset.skin, worn: window.__surf.surfer().materials.skin.color.getHexString() }));
      assert.equal(got.loadout.toLowerCase(), next.toLowerCase());
      assert.equal(got.stored.toLowerCase(), next.toLowerCase(), "the tone was not saved");
      assert.equal(got.preview.toLowerCase(), next.toLowerCase());
      assert.equal(got.on.toLowerCase(), next.toLowerCase(), "the swatch is not marked");
      const bodyCardAfter = await page.evaluate(() => document.querySelector('#lk-list [data-equip="male"] canvas').toDataURL());
      assert.notEqual(bodyCardAfter, bodyCardBefore, "the body card was not repainted for the new tone");
    });

    if (c.name === "male, desktop") {
      await ok("closing disposes what the Locker made: counts, listeners, tone mapping and the holder are identical after each open and close", async () => {
        await closeLocker(page);
        await openLocker(page); // warm-up: the other body's textures and geometry upload once, on its body card
        await closeLocker(page);
        const base = await gl(page);
        assert.equal(base.holderInScene, true);
        for (let i = 0; i < 3; i++) {
          await openLocker(page);
          const open = await gl(page);
          assert.equal(open.holderInScene, false, "the surfer should be in the studio while open");
          await closeLocker(page);
          const now = await gl(page);
          assert.deepEqual(now, base, `cycle ${i + 1}: after close ${JSON.stringify(now)} differs from ${JSON.stringify(base)}`);
          assert.equal(now.listeners.locker, 0, "the Locker's own elements still hold listeners");
          assert.equal(await page.evaluate(() => document.querySelector("#lk-view")), null);
        }
        console.log(`     closed state: ${base.geometries} geometries, ${base.textures} textures, ${base.listeners.persistent} page listeners, tone mapping ${base.toneMapping}`);
        await page.click("#open-locker");
        await page.click("#locker-back");
        await new Promise((r) => setTimeout(r, 1200));
        assert.deepEqual(await gl(page), base, "an open closed at once changed the counts");
      });
    }
    await context.close();
  }
  await ok("skin (all six tones) and cloth (every catalog and gear-table colour) read as their swatches in the Locker's studio light (scripts/studio-calibrate.mjs check)", async () => {
    const r = spawnSync(process.execPath, [join(root, "scripts", "studio-calibrate.mjs"), "check"], { cwd: root, encoding: "utf8" });
    const lines = r.stdout.split("\n").filter((l) => /within tolerance|OUT/.test(l));
    console.log(lines.map((l) => `     ${l}`).join("\n"));
    assert.equal(r.status, 0, `studio calibration is out of tolerance:\n${r.stdout}${r.stderr}`);
  });
  await ok("no page errors or console errors in the whole run", async () => {
    assert.deepEqual(problems, []);
  });
  console.log(`locker checks passed (${checks} groups)`);
} catch (e) {
  console.error(e);
  console.error(problems.length ? "PAGE PROBLEMS:\n" + problems.join("\n") : "");
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
