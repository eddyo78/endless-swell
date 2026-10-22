// Screenshots of the Locker (milestone 6): the live studio preview beside the picture cards.
//
//   node scripts/shots-locker.mjs [--out <dir>] [--skin <#rrggbb>] [--skip-build]
//
// Serves dist/ on a local port for the life of this script, drives headless Chrome through the window.__surf hooks and the real
// buttons, waits until every visible card has its picture, and writes PNGs: the Locker open for the male and the female at
// desktop width, the female at phone width, a close look at some cards, and the preview trying on a locked premium piece.
// The browser and the server are closed in a finally block. Needs a local Chrome (CHROME_PATH or the usual Mac path).
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const optIdx = argv.indexOf("--out");
const outDir = optIdx >= 0 ? argv[optIdx + 1] : join(root, "..", "_reports", "m6");
const skinIdx = argv.indexOf("--skin");
const skin = skinIdx >= 0 ? argv[skinIdx + 1] : null;
if (skin !== null && !/^#[0-9a-fA-F]{6}$/.test(skin)) throw new Error(`--skin wants #rrggbb, got ${skin}`);
const dist = join(root, "dist");
const CHROME = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) throw new Error("no Chrome found; set CHROME_PATH");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

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
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=metal", "--window-size=1440,900"],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });

  async function openLocker(body, viewport, { gear = true } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()}`);
    });
    await page.setViewport(viewport);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
    await page.evaluate((b, withGear, tone) => {
      const S = window.__surf;
      S.setBody(b);
      if (tone) S.setSkin(tone);
      if (withGear) {
        for (let i = 0; i < 4; i++) S.grantGear("common", 10 + i);
        for (let i = 0; i < 4; i++) S.grantGear("rare", 20 + i);
        for (let i = 0; i < 2; i++) S.grantGear("epic", 30 + i);
      }
      S.menu();
    }, body, gear, skin);
    await page.click("#open-locker");
    return { page, context };
  }
  async function settle(page, angle = 0.55) {
    // let the lazy pictures render, then freeze the turntable at a known angle
    await page.waitForFunction(() => {
      const v = window.__surf.locker();
      return v && v.pending === 0 && v.stats.stageFrames > 3;
    }, { timeout: 120000 });
    await page.evaluate((a) => { window.__surf.locker().turn(a); }, angle);
    await new Promise((r) => setTimeout(r, 400));
    await page.waitForFunction(() => window.__surf.locker().pending === 0, { timeout: 60000 });
  }
  const shot = async (page, name, clip) => {
    const file = join(outDir, name);
    await page.screenshot({ path: file, type: "png", ...(clip ? { clip } : {}) });
    console.log("wrote", file);
  };

  for (const body of ["male", "female"]) {
    const { page, context } = await openLocker(body, { width: 1280, height: 720, deviceScaleFactor: 1 });
    await settle(page);
    await shot(page, `locker-${body}-desktop.png`);
    const info = await page.evaluate(() => { const v = window.__surf.locker(); return { stats: v.stats, state: v.state(), pics: window.__surf.lockerPictures() }; });
    console.log(body, JSON.stringify(info.stats), JSON.stringify(info.pics));
    if (body === "female") {
      // a close look at cards: the top of the list at 2x
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
      await settle(page);
      const box = await page.evaluate(() => { const r = document.querySelector("#lk-list").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 360) }; });
      await shot(page, "locker-female-cards-close.png", box);
      await page.evaluate(() => { document.querySelector("#lk-list").scrollTop = 420; });
      await settle(page);
      await shot(page, "locker-female-cards-close-2.png", await page.evaluate(() => { const r = document.querySelector("#lk-list").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 360) }; }));
      await page.evaluate(() => { document.querySelector("#lk-list").scrollTop = 0; });
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
      await settle(page);
      // try on a locked premium rashguard set
      await page.click('[data-equip="rash-gold-f"]');
      await settle(page, 0.55);
      await shot(page, "locker-female-tryon-premium.png");
      const st = await page.evaluate(() => ({ loadout: window.__surf.save().loadout, state: window.__surf.locker().state() }));
      console.log("try-on", JSON.stringify(st.loadout), st.state.badge.replace(/\n/g, " | "));
    } else {
      await page.click('[data-equip="board-fish"]');
      await settle(page, 2.0);
      await shot(page, "locker-male-tryon-premium-board.png");
      const st = await page.evaluate(() => ({ loadout: window.__surf.save().loadout, state: window.__surf.locker().state() }));
      console.log("try-on", JSON.stringify(st.loadout), st.state.badge.replace(/\n/g, " | "));
    }
    await context.close();
  }
  {
    const { page, context } = await openLocker("female", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await settle(page);
    await shot(page, "locker-female-phone.png");
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  server.close();
}
if (problems.length) console.log("PAGE PROBLEMS:\n" + problems.join("\n"));
