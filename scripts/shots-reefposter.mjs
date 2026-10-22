// Screenshots of the "Reef Poster" screens built from the mockups in _reports/aaa/mockups: the title screen, the Locker (every tab) and a
// ride with a trick popup up, at desktop and phone size, with the lightest skin tone.
//
//   node scripts/shots-reefposter.mjs [--out <dir>] [--skip-build] [--view desktop|phone] [--only menu|locker|ride]
//
// Serves dist/ on a local port for the life of this script, drives headless Chrome through the window.__surf hooks and the real
// buttons, writes PNGs. The browser and the server are closed in a finally block. Needs a local Chrome (CHROME_PATH or the usual
// Mac path).
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const optIdx = argv.indexOf("--out");
const outDir = optIdx >= 0 ? argv[optIdx + 1] : join(root, "..", "_reports", "aaa", "build1");
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const onlyView = argv.includes("--view") ? argv[argv.indexOf("--view") + 1] : null;
const dist = join(root, "dist");
const CHROME = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) throw new Error("no Chrome found; set CHROME_PATH");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const LIGHT = "#f1c27d";

if (!argv.includes("--skip-build")) {
  const r = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`npm run build exited ${r.status}`);
}
mkdirSync(outDir, { recursive: true });

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
let browser = null;
const VIEWS = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=metal", "--window-size=1440,900"],
    defaultViewport: VIEWS.desktop,
  });
  async function open(view, body) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
    });
    await page.setViewport(VIEWS[view]);
    await page.evaluateOnNewDocument(() => localStorage.setItem("endless-swell-hint-v1", "1"));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
    await page.evaluate((b, tone) => {
      const S = window.__surf;
      S.pause = true;
      S.setBody(b);
      S.setSkin(tone);
      for (let i = 0; i < 3; i++) S.grantGear("common", 10 + i);
      for (let i = 0; i < 2; i++) S.grantGear("rare", 20 + i);
      S.grantGear("epic", 30);
      const s = S.save();
      s.season = 3;
      s.event = 4;
      s.points = 790;
      s.trophies = [{ season: 1, place: 4 }, { season: 2, place: 2 }];
      S.menu();
      S.advance(1.2);
    }, body, LIGHT);
    await page.evaluate(() => document.fonts.ready);
    return { page, context };
  }
  const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));
  const advance = (page, s) => page.evaluate((x) => window.__surf.advance(x), s);
  // the popups' animations run on the wall clock while the shots advance the ride in jumps: hold them at their full-size moment
  const holdPopups = (page) => page.evaluate(() => document.getAnimations().forEach((a) => { if (a.effect && a.effect.target && a.effect.target.closest("#popups")) { a.pause(); a.currentTime = 450; } }));
  const frames = (page, n = 2) => page.evaluate((count) => new Promise((resolve) => { let i = 0; const tick = () => (++i >= count ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);
  const shot = async (page, name) => {
    // the first capture of a page with device emulation resizes the view and clears the WebGL canvas: take one and throw it away
    if (!page.__warm) {
      page.__warm = true;
      await page.screenshot({ type: "png" });
      await frames(page);
    }
    await page.evaluate(() => window.__surf.render());
    const file = join(outDir, name);
    await page.screenshot({ path: file, type: "png" });
    console.log("wrote", file);
  };
  const openLocker = async (page) => {
    await page.click("#open-locker");
    await page.waitForFunction(() => { const v = window.__surf.locker(); return v && v.ready && v.pending === 0 && v.stats.stageFrames > 3; }, { timeout: 120000 });
    await page.evaluate(() => window.__surf.locker().turn(0.55));
    await settle(400);
  };
  const lockerTab = async (page, tab) => {
    await page.click(`[data-tab="${tab}"]`);
    await page.waitForFunction(() => window.__surf.locker().pending === 0, { timeout: 60000 });
    await settle(500);
    await page.waitForFunction(() => window.__surf.locker().pending === 0, { timeout: 60000 });
  };

  for (const view of ["desktop", "phone"].filter((v) => !onlyView || v === onlyView)) {
    // the title screen, both bodies
    for (const body of ["female", "male"].filter(() => !only || only === "menu")) {
      const { page, context } = await open(view, body);
      await advance(page, 0.6);
      await shot(page, `${view}-menu-${body}.png`);
      await context.close();
    }
    // the Locker: boards, outfits, surfers, shelf; the first with a locked premium board on trial
    if (!only || only === "locker") {
      const { page, context } = await open(view, "male");
      await openLocker(page);
      await shot(page, `${view}-locker-board.png`);
      await page.evaluate(() => { const ids = [...document.querySelectorAll("#lk-list .item[data-locked]")].map((b) => b.dataset.equip); window.__trial = ids[0]; });
      await page.evaluate(() => document.querySelector(`#lk-list [data-equip="${window.__trial}"]`).click());
      await settle(500);
      await page.waitForFunction(() => window.__surf.locker().pending === 0, { timeout: 60000 });
      await shot(page, `${view}-locker-board-trying.png`);
      await lockerTab(page, "outfit");
      await shot(page, `${view}-locker-outfit.png`);
      await lockerTab(page, "surfer");
      await shot(page, `${view}-locker-surfer.png`);
      await lockerTab(page, "shelf");
      await shot(page, `${view}-locker-shelf.png`);
      await context.close();
    }
    if (!only || only === "locker") {
      const { page, context } = await open(view, "female");
      await openLocker(page);
      await lockerTab(page, "outfit");
      await shot(page, `${view}-locker-outfit-female.png`);
      await context.close();
    }
    // a ride with a trick popup up
    if (!only || only === "ride") {
      const { page, context } = await open(view, "male");
      await page.click("#play-tour");
      await page.click("#begin-heat");
      await page.evaluate(() => window.__surf.setAutopilot(true));
      let want = ["barrel"];
      let got = false;
      for (let i = 0; i < 1200 && !got; i++) {
        await advance(page, 0.1);
        got = await page.evaluate((w) => window.__surf.hud().popups.some((p) => w.includes(p)), want);
      }
      console.log(view, "popup up:", got, JSON.stringify(await page.evaluate(() => window.__surf.hud())));
      await holdPopups(page);
      await shot(page, `${view}-ride-popup.png`);
      for (let i = 0; i < 1200; i++) {
        await advance(page, 0.1);
        if (await page.evaluate(() => window.__surf.hud().popups.includes("spit"))) {
          await holdPopups(page);
          await shot(page, `${view}-ride-spit.png`);
          break;
        }
        if (await page.evaluate(() => window.__surf.mode() !== "ride")) break;
      }
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  server.close();
}
if (problems.length) console.log("PAGE PROBLEMS:\n" + problems.join("\n"));
