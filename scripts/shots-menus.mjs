// Screenshots of every menu screen (the polish pass): main menu, help, event brief, the HUD in a ride, a heat result, an event
// result with a rank up and a trophy, free-surf end and the Locker, at desktop and phone width, with the lightest skin tone.
//
//   node scripts/shots-menus.mjs [--out <dir>] [--skip-build]
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
const outDir = optIdx >= 0 ? argv[optIdx + 1] : join(root, "..", "_reports", "polish", "menus");
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
  async function open(view, { body = "female", fresh = true } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
    });
    await page.setViewport(VIEWS[view]);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__surf && window.__surf.ready, { timeout: 120000 });
    await page.evaluate((b, tone) => {
      const S = window.__surf;
      S.pause = true;
      S.setBody(b);
      S.setSkin(tone);
      for (let i = 0; i < 3; i++) S.grantGear("common", 10 + i);
      for (let i = 0; i < 2; i++) S.grantGear("rare", 20 + i);
      S.menu();
      S.advance(0.6);
    }, body, LIGHT);
    await page.evaluate(() => document.fonts.ready);
    return { page, context };
  }
  const settle = (page, ms = 500) => new Promise((r) => setTimeout(r, ms));
  const advance = (page, s) => page.evaluate((x) => window.__surf.advance(x), s);
  const shot = async (page, name) => {
    await page.evaluate(() => window.__surf.render());
    const file = join(outDir, name);
    await page.screenshot({ path: file, type: "png" });
    console.log("wrote", file);
  };

  for (const view of ["desktop", "phone"]) {
    // a fresh page: the main menu with the first-run hint, then the help screen
    {
      const { page, context } = await open(view);
      await advance(page, 0.5);
      await shot(page, `${view}-01-menu-first-run.png`);
      await page.click("#open-help");
      await settle(page, 300);
      await shot(page, `${view}-02-help.png`);
      await page.click("#help-back");
      await page.click("#play-free");
      await advance(page, 1.5);
      await settle(page, 700);
      await shot(page, `${view}-01b-ride-first-run-hint.png`);
      await context.close();
    }
    // a returning player (hint already seen), mid-season, with a trophy shelf and a rank
    {
      const { page, context } = await open(view, { body: "male" });
      await page.evaluate(() => {
        localStorage.setItem("endless-swell-hint-v1", "1");
        const s = window.__surf.save();
        s.season = 3;
        s.event = 4;
        s.points = 790;
        s.trophies = [{ season: 1, place: 4 }, { season: 2, place: 2 }];
        window.__surf.menu();
        window.__surf.advance(0.5);
      });
      await shot(page, `${view}-03-menu-returning.png`);
      await page.click("#play-tour");
      await advance(page, 0.5);
      await shot(page, `${view}-04-brief.png`);
      // the HUD in a ride: into the heat, ride for a while on the autopilot until the surfer is in the tube
      await page.click("#begin-heat");
      await page.evaluate(() => window.__surf.setAutopilot(true));
      let got = false;
      for (let i = 0; i < 40 && !got; i++) {
        await advance(page, 0.5);
        got = await page.evaluate(() => { const st = window.__surf.state(); return window.__surf.mode() === "ride" && st.inTube && st.tube > 0.8; });
      }
      console.log(view, "ride reached tube:", got);
      await shot(page, `${view}-05-hud-ride.png`);
      await page.evaluate(() => window.__surf.setAutopilot(false));
      // a heat result from a real heat on the autopilot: every wave listed, the best two marked as counting
      await page.evaluate(() => window.__surf.setAutopilot(true));
      let mode = "";
      for (let i = 0; i < 200 && mode !== "result"; i++) {
        await advance(page, 1);
        mode = await page.evaluate(() => window.__surf.mode());
      }
      console.log(view, "heat ended in mode:", mode);
      await page.evaluate(() => window.__surf.setAutopilot(false));
      await advance(page, 0.3);
      await shot(page, `${view}-06-heat-result.png`);
      await context.close();
    }
    // the season finale: a runner-up finish that ranks the player up and puts a trophy on the shelf, with new gear
    {
      const { page, context } = await open(view);
      await page.evaluate(() => {
        localStorage.setItem("endless-swell-hint-v1", "1");
        const s = window.__surf.save();
        s.season = 1;
        s.event = 10;
        s.points = 800;
        window.__surf.startTour();
        window.__surf.forceFinish(2);
      });
      await advance(page, 0.3);
      await settle(page, 1800);
      await shot(page, `${view}-07-event-result-rankup-trophy.png`);
      await page.click("#end-menu");
      await context.close();
    }
    // free-surf end
    {
      const { page, context } = await open(view);
      await page.evaluate(() => localStorage.setItem("endless-swell-hint-v1", "1"));
      await page.click("#play-free");
      await page.evaluate(() => window.__surf.setAutopilot(true));
      for (let i = 0; i < 80 && (await page.evaluate(() => window.__surf.mode())) !== "freeend"; i++) await advance(page, 0.5);
      await advance(page, 0.2);
      await shot(page, `${view}-08-free-end.png`);
      await context.close();
    }
    // the Locker
    {
      const { page, context } = await open(view);
      await page.click("#open-locker");
      await page.waitForFunction(() => { const v = window.__surf.locker(); return v && v.pending === 0 && v.stats.stageFrames > 3; }, { timeout: 120000 });
      await page.evaluate(() => window.__surf.locker().turn(0.55));
      await settle(page, 500);
      await page.waitForFunction(() => window.__surf.locker().pending === 0, { timeout: 60000 });
      const file = join(outDir, `${view}-09-locker.png`);
      await page.screenshot({ path: file, type: "png" });
      console.log("wrote", file);
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  server.close();
}
if (problems.length) console.log("PAGE PROBLEMS:\n" + problems.join("\n"));
